import {
  Bot,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  FileText,
  AlertCircle,
  BookOpen,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Citation {
  clause: string;
  page: number;
  title: string;
  excerpt: string;
}

interface ActionLink {
  label: string;
  path: string;
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  suggestedFollowups?: string[];
  actionLinks?: ActionLink[];
  timestamp: string;
}

const STARTER_PROMPTS = [
  "What is the status of my application?",
  "Explain my active deficiencies",
  "What are the Faculty-Student Ratio (FSR) norms?",
  "What documents are required for EoA under Annexure 2?",
  "What is the procedure for Scrutiny and Appeal under Clause 1.8?",
];

export function CopilotDrawer() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copilotStatus, setCopilotStatus] = useState<{ totalPages: number; version: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load Copilot status on mount
  useEffect(() => {
    api.get('/api/copilot/status')
      .then((res: any) => {
        if (res?.ok) setCopilotStatus(res);
      })
      .catch(() => {});
  }, []);

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'msg-welcome',
          sender: 'assistant',
          text:
            `### Welcome to AICTE Approval Process Copilot\n\n` +
            `I am your official compliance assistant, strictly grounded in the **AICTE Approval Process Handbook (APH 2024–27)** and synchronized with your institution's active application record.\n\n` +
            `**How I can assist you:**\n` +
            `- **Instant Statutory Lookup**: Exact norms for Faculty Ratios, Land & Built-up Area, Computers, and EoA.\n` +
            `- **Application & Deficiency Guidance**: Statutory steps to resolve open deficiencies and appear before Scrutiny / SHC.\n` +
            `- **Zero Hallucination**: Every answer quotes statutory clauses and provides page numbers.\n\n` +
            `Ask me anything below or pick a suggested topic to get started!`,
          suggestedFollowups: STARTER_PROMPTS.slice(0, 3),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [messages.length]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [isOpen, messages]);

  const handleSend = async (queryText?: string) => {
    const textToSend = (queryText || inputValue).trim();
    if (!textToSend || loading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryText) setInputValue('');
    setLoading(true);

    try {
      const res: any = await api.post('/api/copilot/query', { query: textToSend });

      const assistantMsg: Message = {
        id: `asst-${Date.now()}`,
        sender: 'assistant',
        text: res.answer || "I could not find this in the Approval Process Handbook.",
        citations: res.citations || [],
        suggestedFollowups: res.suggestedFollowups || [],
        actionLinks: res.actionLinks || [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: `**Error**: ${err?.message || 'Unable to process query. Please check your network or try again.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  // Render markdown text nicely with headers, bolding, quotes, lists
  const renderFormattedText = (raw: string) => {
    const lines = raw.split('\n');
    return lines.map((line, idx) => {
      if (line.startsWith('### ')) {
        return (
          <h3 key={idx} className="text-base font-bold text-slate-900 mt-2 mb-1 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" />
            {line.replace('### ', '')}
          </h3>
        );
      }
      if (line.startsWith('#### ')) {
        return (
          <h4 key={idx} className="text-sm font-semibold text-slate-800 mt-2 mb-1 text-indigo-900">
            {line.replace('#### ', '')}
          </h4>
        );
      }
      if (line.startsWith('> ')) {
        return (
          <blockquote key={idx} className="border-l-4 border-indigo-500 bg-indigo-50/60 text-slate-800 italic px-3 py-1.5 my-1.5 rounded-r text-xs leading-relaxed">
            {line.replace('> ', '')}
          </blockquote>
        );
      }
      if (line.startsWith('- ')) {
        return (
          <li key={idx} className="ml-4 list-disc text-xs text-slate-700 my-0.5 leading-relaxed">
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.replace('- ', '')) }} />
          </li>
        );
      }
      if (line.trim() === '') {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <p key={idx} className="text-xs text-slate-700 leading-relaxed my-0.5" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
      );
    });
  };

  const formatInline = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic text-slate-800">$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>');
  };

  return (
    <>
      {/* Floating Trigger Pill at bottom-right */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-navy-900 via-indigo-900 to-indigo-800 text-white rounded-full shadow-2xl hover:shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-all duration-200 border border-indigo-400/30 group"
          title="Open AICTE Handbook & Application Copilot"
        >
          <div className="relative">
            <Bot className="w-5 h-5 text-indigo-300 group-hover:text-white transition-colors" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full" />
          </div>
          <div className="text-left leading-tight pr-1">
            <div className="text-xs font-bold tracking-wide flex items-center gap-1.5">
              <span>AICTE Copilot</span>
              <Sparkles className="w-3 h-3 text-amber-300 fill-amber-300" />
            </div>
            <div className="text-[10px] text-indigo-200 font-medium">APH 2024–27 Advisor</div>
          </div>
        </button>
      )}

      {/* Slide-over Chat Drawer */}
      {isOpen && (
        <div
          className={`fixed bottom-4 right-4 z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col transition-all duration-300 overflow-hidden ${
            isExpanded ? 'w-[720px] h-[85vh]' : 'w-[440px] h-[640px]'
          } max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)]`}
        >
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-navy-900 via-indigo-950 to-navy-900 text-white flex items-center justify-between border-b border-indigo-900/60 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/50 border border-indigo-400/40 flex items-center justify-center shrink-0 shadow-inner">
                <Bot className="w-4 h-4 text-indigo-200" />
              </div>
              <div>
                <div className="text-xs font-bold tracking-wide flex items-center gap-2">
                  <span>AICTE Approval Copilot</span>
                  <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 px-1.5 py-0.2 rounded font-mono font-semibold">
                    APH 2024–27
                  </span>
                </div>
                <div className="text-[10px] text-slate-300 font-normal">
                  Statutory Handbook Retrieval & Live Application Copilot
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={clearChat}
                title="Clear Conversation"
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/10 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? 'Collapse Drawer' : 'Expand Drawer'}
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/10 transition-colors"
              >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Close Copilot"
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/10 transition-colors ml-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sub-header Context Bar */}
          <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="font-semibold text-slate-800 truncate">
                {user?.fullName || 'Applicant Institution'}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-slate-500">
                {copilotStatus ? `${copilotStatus.totalPages} Pages Indexed` : '231 Pages'}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </div>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/40">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-3 shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-br-none'
                      : 'bg-white text-slate-900 border border-slate-200 rounded-bl-none shadow-indigo-100/50'
                  }`}
                >
                  {msg.sender === 'assistant' && (
                    <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-slate-100">
                      <Bot className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                        Approval Handbook AI
                      </span>
                      <span className="text-[9px] text-slate-400 ml-auto">{msg.timestamp}</span>
                    </div>
                  )}

                  <div className="text-xs">
                    {msg.sender === 'user' ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    ) : (
                      renderFormattedText(msg.text)
                    )}
                  </div>

                  {/* Citation Pills */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <FileText className="w-3 h-3 text-indigo-500" />
                        <span>Statutory Citations (Click to view full excerpt):</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.citations.map((c, i) => (
                          <button
                            key={i}
                            onClick={() => setSelectedCitation(c)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-colors shadow-xs"
                          >
                            <span>{c.clause}</span>
                            <span className="text-indigo-500 font-normal">p.{c.page}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Link Buttons */}
                  {msg.actionLinks && msg.actionLinks.length > 0 && (
                    <div className="mt-3 pt-2 flex flex-wrap gap-2">
                      {msg.actionLinks.map((al, idx) => (
                        <Link
                          key={idx}
                          to={al.path}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-xs"
                        >
                          <span>{al.label}</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                {/* Follow-up question chips */}
                {msg.suggestedFollowups && msg.suggestedFollowups.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 max-w-[92%]">
                    {msg.suggestedFollowups.map((f, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(f)}
                        className="text-[10px] font-medium bg-white text-indigo-700 hover:bg-indigo-50 border border-indigo-200/80 px-2.5 py-1 rounded-full shadow-2xs hover:border-indigo-300 transition-all flex items-center gap-1 text-left"
                      >
                        <span>{f}</span>
                        <ChevronRight className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 p-3 bg-white rounded-xl border border-slate-200 max-w-[70%] shadow-xs">
                <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin" />
                <span className="text-xs text-slate-600">Retrieving official clauses from APH 2024–27...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Citation Preview Modal */}
          {selectedCitation && (
            <div className="p-3.5 bg-indigo-50/90 border-t border-indigo-200 text-xs text-slate-800 shrink-0 max-h-48 overflow-y-auto">
              <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-indigo-200/60">
                <div className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-700" />
                  <span>{selectedCitation.clause}: {selectedCitation.title}</span>
                  <span className="text-[10px] bg-indigo-200 text-indigo-900 px-1.5 py-0.5 rounded font-mono">
                    Page {selectedCitation.page}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedCitation(null)}
                  className="p-1 text-slate-500 hover:text-slate-800 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-700 italic leading-relaxed whitespace-pre-wrap">
                "{selectedCitation.excerpt}"
              </p>
            </div>
          )}

          {/* Quick suggestions if no recent messages */}
          {messages.length <= 1 && (
            <div className="px-4 py-2 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Try:</span>
              {STARTER_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(p)}
                  className="shrink-0 text-[10px] text-slate-700 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 px-2 py-0.8 rounded-full border border-slate-200 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Input Footer */}
          <div className="p-3 bg-white border-t border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about handbook clauses, FSR, or your application..."
                disabled={loading}
                className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !inputValue.trim()}
                className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 shadow-xs"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 px-1">
              <span>Press <strong>Enter</strong> to send</span>
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                APH 2024–27 Legal Grounding
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
