import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  Menu, 
  Plus, 
  MessageSquare, 
  Settings, 
  HelpCircle, 
  ChevronDown, 
  Image as ImageIcon, 
  Mic, 
  Send,
  Sparkles,
  User,
  AlertTriangle,
  Check,
  X,
  Trash2
} from 'lucide-react';

/**
 * Main Application Component for the RAG2SQL Chatbot.
 * Handles state management, backend integration, and renders the full UI.
 *
 * Supports Human-in-the-Loop (HITL) approvals: when the agent needs to
 * execute a destructive SQL operation (INSERT/UPDATE/DELETE), the backend
 * returns a `hitl_pending` status. The UI renders an inline approval card
 * in the chat. The user can Approve or Reject. The decision is sent to
 * POST /approve, which resumes the agent graph.
 */
function App() {
  // --- UI States ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // toggles sidebar visibility
  const [currentView, setCurrentView] = useState('chat'); // toggles between chat and settings
  const [theme, setTheme] = useState(() => localStorage.getItem('rag2sql_theme') || 'dark');
  // manages app theme, defaults to dark

  // background :
  // generates random background icons once when app is mounted
  const backgroundIcons = useMemo(() => {
    const icons = [];
    for (let i = 0; i < 15; i++) { // Reduced from 50 to 15 for better readability
      const isSqlIcon = Math.random() > 0.5;
      icons.push({
        id: i,
        type: isSqlIcon ? '/sqlite-logo.svg' : '/bg-pattern.svg',
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: isSqlIcon ? '120px' : '40px'
      });
    }
    return icons;
  }, []);

  // manages chat states data
  // localStorage persists data permanently in the browser 
  const [recentChats, setRecentChats] = useState(() => {
    const saved = localStorage.getItem('rag2sql_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Normalize all IDs to strings for consistent === comparisons
        return parsed.map(chat => ({ ...chat, id: String(chat.id) }));
      } catch (e) {
        console.error("Failed to parse chats from localStorage");
      }
    }
    // default dummy data is only shown once, when the app is opened.
    return [
      {
        id: '1',
        title: 'React UI Design Patterns',
        messages: [
          { id: '101', type: 'user', content: 'What are some common React UI Design Patterns?' },
          { id: '102', type: 'ai', content: 'Common patterns include Higher-Order Components (HOC), Render Props, Custom Hooks, and Compound Components.' }
        ]
      },
      {
        id: '2',
        title: 'Explain Quantum Computing',
        messages: [
          { id: '201', type: 'user', content: 'Can you explain quantum computing to a 5 year old?' },
          { id: '202', type: 'ai', content: 'Imagine a magic coin. A normal coin is either heads or tails. A quantum coin can be heads, tails, or a magical mix of both at the same time while it is spinning!' }
        ]
      },
      { id: '3', title: 'Dinner Recipes ideas', messages: [] }
    ];
  });

  // Tracks the active chat session ID (persisted)
  const [currentChatId, setCurrentChatId] = useState(() => {
    const saved = localStorage.getItem('rag2sql_current_chat_id');
    return saved ? String(JSON.parse(saved)) : '1';
  });

  // states for the fields like tyext input of the user, typing or not...
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false); // shows if the AI is generating a response
  const [chatIdToDelete, setChatIdToDelete] = useState(null); // track which chat is in confirmation mode
  const messagesEndRef = useRef(null); // ref to scroll to bottom of chat
  const textareaRef = useRef(null); // ref to auto-resize textarea

  // use effects for local storage. 

  // apply theme changes and store them so when page is refreshed or closed it doesn't go back to default.
  useEffect(() => {
    localStorage.setItem('rag2sql_theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  // persist chat history whenever it changes
  useEffect(() => {
    localStorage.setItem('rag2sql_chats', JSON.stringify(recentChats));
  }, [recentChats]);

  // persist the currently selected chat ID
  useEffect(() => {
    localStorage.setItem('rag2sql_current_chat_id', JSON.stringify(currentChatId));
  }, [currentChatId]);

  // derive the active chat and its messages for rendering
  const activeChat = recentChats.find(chat => chat.id === currentChatId) || recentChats[0];
  const currentMessages = activeChat ? activeChat.messages : [];

  // --- Helper: append a message to the active chat ---
  const appendMessage = (msg) => {
    setRecentChats(prev => prev.map(chat =>
      chat.id === currentChatId
        ? { ...chat, messages: [...chat.messages, msg] }
        : chat
    ));
  };

  // --- Helper: mark the last HITL message as resolved ---
  const resolveHitl = (decision) => {
    setRecentChats(prev => prev.map(chat => {
      if (chat.id !== currentChatId) return chat;
      const msgs = [...chat.messages];
      // Find the last unresolved hitl message and mark it resolved
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].type === 'hitl' && !msgs[i].resolved) {
          msgs[i] = { ...msgs[i], resolved: true, decision };
          break;
        }
      }
      return { ...chat, messages: msgs };
    }));
  };

  /**
   * Simple markdown parser to handle tables, bold, and code.
   * Converts markdown string to HTML for rich display.
   */
  const formatMessage = (content) => {
    if (!content) return '';

    // Handle Bold: **text**
    let formatted = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Handle Inline Code: `code`
    formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');

    // Handle Tables: detect markdown tables and convert to HTML
    const lines = formatted.split('\n');
    let inTable = false;
    let tableHtml = '';
    const newLines = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      // Detect table line: must contain | and not be just a separator line
      if (trimmed.includes('|') && (trimmed.match(/\|/g) || []).length > 1) {
        // Check if it's a separator line like |---|---|
        if (/^\|?([\s-]*\|)+[\s-]*\|?$/.test(trimmed)) {
          if (inTable) return; // Skip separator line inside table
        }

        if (!inTable) {
          inTable = true;
          tableHtml = '<div class="table-container"><table>';
        }
        
        const cells = trimmed.split('|').map(c => c.trim()).filter((cell, index, array) => {
          // Keep cells that are between pipes
          if (index === 0 && cell === '') return false;
          if (index === array.length - 1 && cell === '') return false;
          return true;
        });
        
        if (cells.length > 0) {
          if (!tableHtml.includes('<thead>')) {
            tableHtml += '<thead><tr>';
            cells.forEach(cell => tableHtml += `<th>${cell}</th>`);
            tableHtml += '</tr></thead><tbody>';
          } else {
            tableHtml += '<tr>';
            cells.forEach(cell => tableHtml += `<td>${cell}</td>`);
            tableHtml += '</tr>';
          }
        }
      } else {
        if (inTable) {
          inTable = false;
          tableHtml += '</tbody></table></div>';
          newLines.push(tableHtml);
          tableHtml = '';
        }
        newLines.push(line);
      }
    });

    if (inTable) {
      tableHtml += '</tbody></table></div>';
      newLines.push(tableHtml);
    }

    return newLines.join('<br />');
  };

  /** Initiates the deletion process by showing the inline confirmation. */
  const askDeleteChat = (id, e) => {
    e.stopPropagation();
    setChatIdToDelete(id);
  };

  /** Cancels the deletion process. */
  const cancelDelete = (e) => {
    e.stopPropagation();
    setChatIdToDelete(null);
  };

  /** Performs the actual deletion after user confirmation. */
  const confirmDelete = (id, e) => {
    e.stopPropagation();
    if (recentChats.length <= 1) {
      alert("You must have at least one active chat session.");
      setChatIdToDelete(null);
      return;
    }
    
    const updatedChats = recentChats.filter(chat => chat.id !== id);
    setRecentChats(updatedChats);
    
    if (currentChatId === id) {
      setCurrentChatId(updatedChats[0].id);
    }
    setChatIdToDelete(null);
  };

  // --- Events ---

  /**
   * Initializes a new chat session.
   * fetches the new uuid thread ID generated, on the backend, falling back to a timestamp.
   */
  const handleNewChat = async () => {
    let newChatId = String(Date.now());
    try {
      const response = await axios.get('http://localhost:8001/new_chat'); //here it connects to the pycharm project that is beign ran next to the ui.
      if (response.data?.thread_id) newChatId = response.data.thread_id;
    } catch (error) {
      console.error("Failed to fetch new thread_id from backend. Using fallback ID.", error);
    }
    const newChat = { 
      id: newChatId, title: `New Chat ${recentChats.length + 1}`, messages: [] 
    };
    setRecentChats(prev => [newChat, ...prev]);
    setCurrentChatId(newChatId);
    setCurrentView('chat');
  };

  /** Scrolls to the most recent message. */
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, isTyping, currentView]);

  /**
   * handles text input changes and dynamically adjusts textarea height.
   */
  const handleInput = (e) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  /**
   * Submits the user's message to the backend.
   * Handles both normal AI responses and HITL_PENDING responses.
   * When HITL is pending, an inline approval card is added to the chat
   * instead of a regular AI message bubble.
   */
  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const userMessageText = inputValue.trim();
    appendMessage(
      { id: Date.now(), type: 'user', content: userMessageText }
    );

    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsTyping(true);

    try {
      // Connect to the FastAPI backend from pycharm
      const response = await axios.post('http://localhost:8001/chat', {
        query: userMessageText,
        thread_id: String(currentChatId)
      });

      if (response.data.status === 'hitl_pending') {
        // Agent needs approval before executing a destructive SQL operation
        appendMessage({
          id: Date.now() + 1,
          type: 'hitl',
          tool_name: response.data.tool_name,
          tool_args: response.data.tool_args,
          resolved: false,
          decision: null
        });
      } else {
        // Normal completed response
        appendMessage({
          id: Date.now() + 1,
          type: 'ai',
          content: response.data.response || "I received a response, but it was empty."
        });
      }
    } catch (error) {
      console.error("Error communicating with backend:", error);
      appendMessage({
        id: Date.now() + 1,
        type: 'ai',
        content: "Sorry, I couldn't connect to the backend server. Please make sure the FastAPI server is running."
      });
    } finally {
      setIsTyping(false);
    }
  };

  /**
   * Sends the user's HITL decision (approve/reject) to the backend.
   * Marks the pending approval card as resolved, then resumes the agent graph.
   * Handles chained HITL events (multiple approvals in a row) and final responses.
   *
   * @param {string} decision - "approve" or "reject"
   */
  const handleApproval = async (decision) => {
    resolveHitl(decision);
    setIsTyping(true);

    try {
      const response = await axios.post('http://localhost:8001/approve', {
        thread_id: String(currentChatId),
        decision
      });

      if (response.data.status === 'hitl_pending') {
        // Agent needs another approval (chained HITL)
        appendMessage({
          id: Date.now() + 1,
          type: 'hitl',
          tool_name: response.data.tool_name,
          tool_args: response.data.tool_args,
          resolved: false,
          decision: null
        });
      } else {
        appendMessage({
          id: Date.now() + 1,
          type: 'ai',
          content: response.data.response || `Action ${decision}d successfully.`
        });
      }
    } catch (error) {
      console.error("Error sending approval:", error);
      appendMessage({
        id: Date.now() + 1,
        type: 'ai',
        content: `Error processing your decision. Please try again.`
      });
    } finally {
      setIsTyping(false);
    }
  };

  /** Allows sending a message with Enter (without Shift). */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className={`sidebar ${!isSidebarOpen ? 'collapsed' : ''}`}>
        <button className="new-chat-btn" onClick={handleNewChat}>
          <Plus size={18} />
          <span>New chat</span>
        </button>

        <div className="recent-chats">
          <div className="recent-chats-title">Recent</div>
          {recentChats.map(chat => (
            <div
              key={chat.id}
              className="chat-history-item"
              onClick={() => { setCurrentChatId(chat.id); setCurrentView('chat'); }}
              style={{
                backgroundColor: chat.id === currentChatId && currentView === 'chat' ? 'var(--bg-surface-hover)' : 'transparent',
                color: chat.id === currentChatId && currentView === 'chat' ? 'var(--text-primary)' : 'var(--text-secondary)'
              }}
            >
              {chatIdToDelete === chat.id ? (
                <div className="delete-confirm-group">
                  <span className="delete-confirm-text">Delete?</span>
                  <button className="confirm-btn yes" onClick={(e) => confirmDelete(chat.id, e)} title="Confirm delete">
                    <Check size={14} />
                  </button>
                  <button className="confirm-btn no" onClick={cancelDelete} title="Cancel">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <MessageSquare size={16} />
                  <span className="chat-title-text">{chat.title}</span>
                  <button 
                    className="delete-chat-btn" 
                    onClick={(e) => askDeleteChat(chat.id, e)}
                    title="Delete chat"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-footer" style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          <div className="chat-history-item" style={{ marginBottom: '0.25rem' }}>
            <HelpCircle size={16} />
            <span>Help & FAQ</span>
          </div>
          <div className="chat-history-item" onClick={() => setCurrentView('settings')}>
            <Settings size={16} />
            <span>Settings</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Background Icons */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
          {backgroundIcons.map(icon => (
            <img
              key={icon.id}
              src={icon.type}
              alt="bg-icon"
              style={{ position: 'absolute', top: `${icon.top}%`, left: `${icon.left}%`, width: icon.size, opacity: 0.5 }}
            />
          ))}
        </div>

        {/* Header */}
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="menu-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)} title="Toggle sidebar">
              <Menu size={24} />
            </button>
            <div className="model-selector">
              <span>RAG2SQL</span> Chatbot
              <ChevronDown size={16} color="var(--text-secondary)" />
            </div>
          </div>
          <div className="user-profile">
            <User size={18} />
          </div>
        </header>

        {currentView === 'chat' ? (
          <>
            {/* Chat Area */}
            <div className="chat-area">
              {currentMessages.length === 0 ? (
                <div className="welcome-screen">
                  <h1 className="welcome-title">Hello, User</h1>
                  <p className="welcome-subtitle">How can I help you today?</p>
                </div>
              ) : (
                <div className="messages-container">
                  {currentMessages.map((msg) => {

                    // --- HITL approval card ---
                    if (msg.type === 'hitl') {
                      if (msg.resolved) {
                        // Show a small resolved pill after the user decided
                        return (
                          <div key={msg.id} className="hitl-resolved">
                            {msg.decision === 'approve'
                              ? <><Check size={14} /> Action approved</>
                              : <><X size={14} /> Action rejected</>
                            }
                          </div>
                        );
                      }
                      // Active approval card
                      return (
                        <div key={msg.id} className="hitl-card">
                          <div className="hitl-header">
                            <AlertTriangle size={18} />
                            <span>Human Approval Required</span>
                          </div>
                          <div className="hitl-body">
                            <p className="hitl-tool-label">
                              Tool: <code className="hitl-tool-name">{msg.tool_name}</code>
                            </p>
                            {msg.tool_args && Object.keys(msg.tool_args).length > 0 && (
                              <pre className="hitl-code">
                                {JSON.stringify(msg.tool_args, null, 2)}
                              </pre>
                            )}
                            <p className="hitl-warning">
                              ⚠️ This operation may permanently modify the database.
                            </p>
                          </div>
                          <div className="hitl-actions">
                            <button
                              className="hitl-btn hitl-btn-reject"
                              onClick={() => handleApproval('reject')}
                              disabled={isTyping}
                            >
                              <X size={15} /> Reject
                            </button>
                            <button
                              className="hitl-btn hitl-btn-approve"
                              onClick={() => handleApproval('approve')}
                              disabled={isTyping}
                            >
                              <Check size={15} /> Approve
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // --- Normal user / AI message ---
                    return (
                      <div key={msg.id} className={`message-row ${msg.type}`}>
                        <div className={`message-avatar ${msg.type}`}>
                          {msg.type === 'ai' ? <Sparkles size={20} /> : <User size={20} />}
                        </div>
                        <div 
                          className="message-content"
                          dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
                        />
                      </div>
                    );
                  })}

                  {/* Typing indicator */}
                  {isTyping && (
                    <div className="message-row ai">
                      <div className="message-avatar ai">
                        <Sparkles size={20} />
                      </div>
                      <div className="message-content" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <div style={{ width: '6px', height: '6px', background: 'var(--text-secondary)', borderRadius: '50%', animation: 'pulseGradient 1s infinite' }} />
                        <div style={{ width: '6px', height: '6px', background: 'var(--text-secondary)', borderRadius: '50%', animation: 'pulseGradient 1s infinite 0.2s' }} />
                        <div style={{ width: '6px', height: '6px', background: 'var(--text-secondary)', borderRadius: '50%', animation: 'pulseGradient 1s infinite 0.4s' }} />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="input-area">
              <div style={{ width: '100%', maxWidth: '800px' }}>
                <div className="input-container">
                  <button className="input-btn" title="Upload image">
                    <ImageIcon size={20} />
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter a prompt here"
                    rows="1"
                  />
                  {inputValue.trim() ? (
                    <button className="input-btn send" onClick={handleSend} title="Send message">
                      <Send size={18} />
                    </button>
                  ) : (
                    <button className="input-btn" title="Use microphone">
                      <Mic size={20} />
                    </button>
                  )}
                </div>
                <div className="footer-text">
                  RAG2SQL may display inaccurate info, so double-check its responses.
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="settings-area">
            <div className="settings-card">
              <h2 className="settings-title">Appearance Settings</h2>
              <div className="theme-toggle">
                <span>Theme Mode</span>
                <button
                  className="toggle-btn"
                  onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                >
                  Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
