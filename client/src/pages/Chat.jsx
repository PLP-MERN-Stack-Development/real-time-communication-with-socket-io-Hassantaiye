// frontend/src/pages/Chat.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { socket } from "../socket/socket"; // Make sure this exports an initialized socket.io-client instance
import axios from "axios";
import { FiSend, FiImage, FiLogOut, FiSearch } from "react-icons/fi";
import { BsDot } from "react-icons/bs";
import notificationSound from "../assets/notify.mp3";

export default function Chat({ user, onLogout }) {
  if (!user) return null;

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [rooms, setRooms] = useState(["general", "random", "tech", "design"]);
  const [currentRoom, setCurrentRoom] = useState("general");
  const [users, setUsers] = useState([]);
  const [typingUser, setTypingUser] = useState("");
  const [file, setFile] = useState(null);
  const [unreadCount, setUnreadCount] = useState({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isConnected, setIsConnected] = useState(socket.connected);

  const messagesEndRef = useRef(null);
  const listRef = useRef(null);
  const audioRef = useRef(new Audio(notificationSound));

  // --- Utility Functions ---
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  const playSound = useCallback(() => {
    try {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
    } catch {
      // ignore blocked autoplay
    }
  }, []);

  const pushLocalMessage = (msg) => setMessages((prev) => [...prev, msg]);

  // --- Load Older Messages (Pagination) ---
  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMoreOlder) return;
    setLoadingOlder(true);

    try {
      const before = messages.length
        ? new Date(messages[0].timestamp).toISOString()
        : new Date().toISOString();

      const res = await axios.get(
        `http://localhost:5000/api/messages?room=${encodeURIComponent(
          currentRoom
        )}&before=${encodeURIComponent(before)}&limit=20`
      );
      const older = res.data || [];
      if (older.length === 0) setHasMoreOlder(false);

      setMessages((prev) => [...older, ...prev]);
    } catch (err) {
      console.error("Failed to load older messages", err);
    } finally {
      setLoadingOlder(false);
    }
  };

  // --- Socket Handlers ---
  useEffect(() => {
    if (!user) return;

    const onReceiveMessage = (msg) => {
      if (msg.room !== currentRoom) {
        setUnreadCount((prev) => ({
          ...prev,
          [msg.room]: (prev[msg.room] || 0) + 1,
        }));
      } else {
        setMessages((prev) => [...prev, msg]);
        playSound();
      }
    };

    const onUserTyping = (data) => {
      if (data.username !== user.username) setTypingUser(data.username);
    };

    const onUserStopTyping = () => setTypingUser("");
    const onUserList = (list) => setUsers(list);

    const onConnect = () => {
      setIsConnected(true);
      socket.emit("join_room", { room: currentRoom, username: user.username });
    };

    const onDisconnect = () => setIsConnected(false);

    socket.on("receive_message", onReceiveMessage);
    socket.on("user_typing", onUserTyping);
    socket.on("user_stop_typing", onUserStopTyping);
    socket.on("userList", onUserList);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.emit("userConnected", user.username);
    socket.emit("join_room", { room: currentRoom, username: user.username });

    return () => {
      socket.off("receive_message", onReceiveMessage);
      socket.off("user_typing", onUserTyping);
      socket.off("user_stop_typing", onUserStopTyping);
      socket.off("userList", onUserList);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [user, currentRoom, playSound]);

  // --- Send Message with File Support ---
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!message && !file) return;

    let fileUrl = null;
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await axios.post("http://localhost:5000/api/upload", formData);
      fileUrl = res.data.url;
      setFile(null);
    }

    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const msgData = {
      id: localId,
      room: currentRoom,
      sender: user.username,
      text: message,
      fileUrl,
      timestamp: new Date().toISOString(),
      status: "sending",
    };

    pushLocalMessage(msgData);
    setMessage("");

    socket.emit("send_message", msgData, (ack) => {
      if (ack && ack.success) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === localId
              ? { ...m, id: ack.serverId || m.id, status: "delivered" }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === localId ? { ...m, status: "failed" } : m))
        );
      }
    });
  };

  // --- Load Messages on Mount ---
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(
          `http://localhost:5000/api/messages?room=${encodeURIComponent(currentRoom)}&limit=50`
        );
        setMessages(res.data || []);
        scrollToBottom();
      } catch (err) {
        console.warn("Failed to load messages", err);
      }
    })();
  }, []);

  // --- Typing Indicator ---
  useEffect(() => {
    const timer = setTimeout(() => {
      socket.emit("user_stop_typing", { room: currentRoom, username: user.username });
    }, 1000);
    return () => clearTimeout(timer);
  }, [message]);

  // --- Filtered Messages (Search) ---
  const filteredMessages = messages.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (m.text && m.text.toLowerCase().includes(q)) ||
      (m.sender && m.sender.toLowerCase().includes(q))
    );
  });

  // --- Room Switching ---
  const handleRoomSwitch = (room) => {
    if (room === currentRoom) return;
    socket.emit("leave_room", { room: currentRoom, username: user.username });
    setCurrentRoom(room);
    setMessages([]);
    setHasMoreOlder(true);
    socket.emit("join_room", { room, username: user.username });

    (async () => {
      try {
        const res = await axios.get(
          `http://localhost:5000/api/messages?room=${encodeURIComponent(room)}&limit=50`
        );
        setMessages(res.data || []);
        scrollToBottom();
      } catch (err) {
        console.warn("Failed to load new room messages", err);
      }
    })();
  };

  return (
    <div className="flex flex-col md:flex-row w-full h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <aside className="w-full md:w-1/4 bg-gray-800 p-4 border-r border-gray-700 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">💬 Rooms</h2>
          <div className="text-sm">{isConnected ? "🟢 Online" : "🔴 Offline"}</div>
        </div>

        <div className="flex flex-col gap-2">
          {rooms.map((r) => (
            <button
              key={r}
              onClick={() => handleRoomSwitch(r)}
              className={`text-left px-3 py-2 rounded-lg ${
                currentRoom === r ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
              }`}
            >
              #{r}{" "}
              {unreadCount[r] > 0 && (
                <span className="ml-2 text-xs bg-red-600 px-2 rounded-full">
                  {unreadCount[r]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div>
          <h3 className="text-lg font-semibold mb-2">Online Users</h3>
          <div className="max-h-48 overflow-y-auto space-y-2">
            {users.map((u) => (
              <div key={u} className="flex items-center gap-2">
                <BsDot className="text-green-500" />
                <div className="text-sm">{u}</div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onLogout}
          className="mt-auto bg-red-600 hover:bg-red-700 p-2 rounded-lg"
        >
          <FiLogOut className="inline mr-2" /> Logout
        </button>
      </aside>

      {/* Chat area */}
      <main className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between bg-gray-800 px-4 py-3 border-b border-gray-700">
          <div>
            <h3 className="font-bold">#{currentRoom}</h3>
            <div className="text-xs text-gray-400">{user.username}</div>
          </div>

          <div className="flex items-center gap-3">
            {typingUser && (
              <div className="text-sm text-gray-300 italic">
                {typingUser} is typing...
              </div>
            )}
            <div className="flex items-center bg-gray-700 rounded px-2">
              <FiSearch />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="bg-transparent outline-none px-2 py-1 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          className="flex-1 overflow-auto p-4 space-y-3"
          style={{ minHeight: 0 }}
        >
          {hasMoreOlder && (
            <div className="flex justify-center">
              <button
                onClick={loadOlderMessages}
                disabled={loadingOlder}
                className="px-3 py-1 bg-gray-700 rounded"
              >
                {loadingOlder ? "Loading..." : "Load older messages"}
              </button>
            </div>
          )}

          {filteredMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.sender === user.username ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-xl p-3 rounded-2xl ${
                  msg.sender === user.username
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-200"
                }`}
              >
                {msg.fileUrl ? (
                  <img
                    src={msg.fileUrl}
                    alt="file"
                    className="rounded max-h-80 object-cover"
                  />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {msg.sender} •{" "}
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        <form
          onSubmit={sendMessage}
          className="flex items-center gap-2 p-3 bg-gray-800 border-t border-gray-700"
        >
          <label htmlFor="file-upload" className="cursor-pointer text-gray-400 hover:text-blue-400">
            <FiImage size={20} />
          </label>
          <input
            id="file-upload"
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files[0])}
          />

          <input
            type="text"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              socket.emit("user_typing", { room: currentRoom, username: user.username });
            }}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 rounded-lg bg-gray-700 focus:outline-none"
          />

          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded"
          >
            <FiSend />
          </button>
        </form>
      </main>
    </div>
  );
}
