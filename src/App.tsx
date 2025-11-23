import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken,
  GoogleAuthProvider, 
  signInWithPopup,    
  signOut,
  updateProfile
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  doc,
  serverTimestamp,
  getDocs,     
  writeBatch   
} from 'firebase/firestore';
import { 
  Mic, 
  MicOff, 
  Send, 
  User, 
  Smartphone, 
  MessageSquare, 
  RefreshCw,
  Sparkles,
  Wand2,
  Trash2,
  LogOut, 
  Chrome,
  ChevronLeft,
  CheckCircle2,
  History,
  X,
  AlertTriangle,
  Volume2, // 音量アイコン追加
  VolumeX  // ミュートアイコン追加
} from 'lucide-react';

// --- Firebase Initialization ---
// 【重要】ご自身のFirebase設定に書き換えてください
const firebaseConfig = {
  apiKey: "AIzaSyDKPKDSkce5vqZxWUbaFQNxSw4q5IhQKM0",
  authDomain: "voicechat-713d5.firebaseapp.com",
  projectId: "voicechat-713d5",
  storageBucket: "voicechat-713d5.firebasestorage.app",
  messagingSenderId: "1035666213654",
  appId: "1:1035666213654:web:fa389db00acd92acfa9e37",
  measurementId: "G-GJHY5L35XC"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Gemini API Helper ---
// 【重要】ご自身のGemini APIキーに書き換えてください
const apiKey = "AIzaSyBkCGSRJLbFzNdARWqSsejUFzYS-ihogEw"; 

const callGemini = async (prompt: string): Promise<string> => {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API Error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (error) {
    console.error("Gemini API call failed:", error);
    return "";
  }
};

// --- Sound & Vibration Helper ---
// ファイル不要で「ピコッ」という音を鳴らす関数
const playNotificationSound = () => {
  try {
    // @ts-ignore
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // 音色の設定（サイン波：柔らかい音）
    osc.type = 'sine';
    // 音程の設定（880Hz "ラ" から 440Hz "ラ" へ下がる音）
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
    
    // 音量の設定（フェードアウト）
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.error("Sound play failed", e);
  }
};

const triggerVibration = () => {
  // Android端末などでバイブレーション（200ミリ秒）
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(200);
  }
};

const notifyUser = () => {
  playNotificationSound();
  triggerVibration();
};

// --- Types ---
type Role = 'sender' | 'receiver' | null;

interface UserProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

interface Message {
  id: string;
  text: string;
  role: 'sender' | 'receiver';
  type: 'text' | 'emoji' | 'preset';
  user?: UserProfile; 
  timestamp: any;
  createdAt: number;
}

// --- Speech Recognition Hook ---
const useSpeechRecognition = () => {
  const [text, setText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.warn('Speech recognition not supported');
      return;
    }

    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ja-JP';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript || interimTranscript) {
        setText(prev => {
            return finalTranscript + interimTranscript;
        });
      }
    };

    recognition.onend = () => {
      if (isListeningRef.current) {
        console.log("Restarting speech recognition...");
        try {
          recognition.start();
        } catch (e) {
          console.error("Restart failed:", e);
          setIsListening(false);
          isListeningRef.current = false;
        }
      } else {
        setIsListening(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      if (event.error === 'not-allowed') {
        alert("マイクの使用が許可されていません。設定を確認してください。");
        setIsListening(false);
        isListeningRef.current = false;
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) {
        alert("このブラウザは音声認識に対応していません。Chrome推奨です。");
        return;
    }

    if (isListening) {
      isListeningRef.current = false;
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        setText('');
        isListeningRef.current = true;
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("Start error:", e);
        isListeningRef.current = false;
      }
    }
  }, [isListening]);

  return { text, setText, isListening, toggleListening };
};

// --- Components ---

// 0. Login Screen
const LoginScreen = ({ setUser }: { setUser: (user: any) => void }) => {
  const [guestName, setGuestName] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/popup-blocked') {
        alert("ポップアップがブロックされました。");
      } else {
        alert(`ログインエラー: ${error.message}`);
      }
    }
  };

  const handleGuestLogin = async () => {
    if (!guestName.trim()) {
      alert("名前を入力してください");
      return;
    }
    setIsLoggingIn(true);
    try {
      const result = await signInAnonymously(auth);
      await updateProfile(result.user, { displayName: guestName });
      setUser({ ...result.user, displayName: guestName });
    } catch (error: any) {
      console.error("Guest login failed", error);
      alert(`ログイン失敗: ${error.message}`);
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-4 font-sans text-white">
      <div className="bg-white/90 backdrop-blur-md p-8 rounded-3xl shadow-2xl max-w-md w-full text-center text-slate-800 animate-fade-in">
        <div className="bg-indigo-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
          <MessageSquare size={40} className="text-indigo-600" />
        </div>
        <h1 className="text-3xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-pink-600">
          Voice Chat
        </h1>
        <p className="text-slate-500 mb-8 font-medium">声でつながる、AIで伝わる</p>

        <button onClick={handleGoogleLogin} className="w-full flex items-center justify-center gap-3 bg-white border-2 border-slate-100 text-slate-700 px-6 py-4 rounded-2xl font-bold hover:bg-slate-50 hover:border-indigo-200 transition-all shadow-sm mb-6 active:scale-95">
          <Chrome size={22} className="text-blue-500" />
          Googleでログイン
        </button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
          <span className="relative z-10 bg-white/0 px-4 text-sm text-slate-400 bg-white">または名前を入力して開始</span>
        </div>

        <div className="space-y-3">
          <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="あなたの名前 (例: 佐藤)" className="w-full px-5 py-4 rounded-2xl border-2 border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all text-slate-700 placeholder:text-slate-400 text-center font-bold" onKeyDown={(e) => e.key === 'Enter' && handleGuestLogin()}/>
          <button onClick={handleGuestLogin} disabled={isLoggingIn} className="w-full bg-slate-800 text-white px-6 py-4 rounded-2xl font-bold hover:bg-slate-900 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
            {isLoggingIn ? '準備中...' : 'ゲストとして参加'}
          </button>
        </div>
      </div>
    </div>
  );
};

// 1. Role Selection Screen
const RoleSelector = ({ onSelect, user }: { onSelect: (role: Role) => void, user: any }) => (
  <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-slate-50 p-4 font-sans relative overflow-hidden">
    <div className="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-indigo-600 to-slate-50 rounded-b-[3rem] shadow-lg z-0"></div>
    <div className="absolute top-4 right-4 flex items-center gap-3 z-10">
       <div className="flex items-center gap-2 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-md">
         {user.photoURL ? <img src={user.photoURL} alt="user" className="w-8 h-8 rounded-full border-2 border-indigo-100" /> : <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">{user.displayName ? user.displayName[0] : <User size={18}/>}</div>}
         <span className="text-sm font-bold text-slate-700">{user.displayName || 'ゲスト'}</span>
       </div>
       <button onClick={() => signOut(auth)} className="p-3 bg-white/90 backdrop-blur rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all shadow-md" title="ログアウト"><LogOut size={20} /></button>
    </div>
    <div className="z-10 w-full max-w-4xl flex flex-col items-center">
      <h1 className="text-4xl font-bold text-white mb-2 text-center drop-shadow-md">ようこそ、{user.displayName || 'ゲスト'}さん</h1>
      <p className="text-indigo-100 mb-12 font-medium">役割を選択してください</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
        <button onClick={() => onSelect('sender')} className="flex flex-col items-center p-8 bg-white rounded-3xl shadow-xl hover:shadow-2xl transition-all hover:-translate-y-2 group relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-cyan-500"></div>
          <div className="p-6 bg-blue-50 rounded-full mb-6 group-hover:bg-blue-100 transition-colors ring-8 ring-blue-50/50"><User size={48} className="text-blue-600" /></div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">送信側 (PC)</h2>
          <p className="text-slate-500 text-center leading-relaxed">マイク入力とAI推敲で<br/>快適にメッセージを作成</p>
        </button>
        <button onClick={() => onSelect('receiver')} className="flex flex-col items-center p-8 bg-white rounded-3xl shadow-xl hover:shadow-2xl transition-all hover:-translate-y-2 group relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 to-green-500"></div>
          <div className="p-6 bg-emerald-50 rounded-full mb-6 group-hover:bg-emerald-100 transition-colors ring-8 ring-emerald-50/50"><Smartphone size={48} className="text-emerald-600" /></div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">受信側 (スマホ)</h2>
          <p className="text-slate-500 text-center leading-relaxed">大画面表示とAI返信案で<br/>スムーズなコミュニケーション</p>
        </button>
      </div>
    </div>
  </div>
);

// 2. Sender (Host) Screen
const SenderScreen = ({ user, collectionName, onBack }: { user: any, collectionName: string, onBack: () => void }) => {
  const { text: recognizedText, setText: setRecognizedText, isListening, toggleListening } = useSpeechRecognition();
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRefining, setIsRefining] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true); // 通知音設定
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true); // 初回マウント判定用

  useEffect(() => {
    if (recognizedText) {
      setInputText(recognizedText);
    }
  }, [recognizedText]);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', collectionName);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      let hasNewMessageFromOthers = false;

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          text: data.text,
          role: data.role,
          type: data.type,
          user: data.user,
          timestamp: data.timestamp,
          createdAt: data.createdAt || 0
        });
      });

      // 新着チェック（docChangesを使用）
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          // 自分が送信者でない、かつ初回読み込みでない場合に通知
          if (data.user?.uid !== user.uid && !isInitialMount.current) {
            hasNewMessageFromOthers = true;
          }
        }
      });

      if (hasNewMessageFromOthers && soundEnabled) {
        notifyUser();
      }

      // 初回読み込み完了フラグを折る
      if (isInitialMount.current) {
        isInitialMount.current = false;
      }

      msgs.sort((a, b) => a.createdAt - b.createdAt);
      setMessages(msgs);
      setErrorMsg(null);
    }, (error) => {
      console.error("Error fetching messages:", error);
      if (error.code === 'permission-denied') {
        setErrorMsg("通信エラー: 権限がありません。Firestoreのルール設定を確認してください。");
      } else {
        setErrorMsg(`通信エラー: ${error.message}`);
      }
    });

    return () => unsubscribe();
  }, [user, collectionName, soundEnabled]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', collectionName), {
        text: inputText,
        role: 'sender',
        type: 'text',
        user: {
          uid: user.uid,
          displayName: user.displayName || '送信者',
          photoURL: user.photoURL
        },
        timestamp: serverTimestamp(),
        createdAt: Date.now()
      });
      setInputText('');
      setRecognizedText(''); 
    } catch (e: any) {
      console.error("Error sending:", e);
      alert(`送信エラー: ${e.message}`);
    }
  };

  const handleRefineText = async () => {
    if (!inputText.trim() || isRefining) return;
    setIsRefining(true);
    const prompt = `以下のテキストを、ビジネスチャットとして自然かつ、誤字脱字を修正し、丁寧な言葉遣いに書き直してください。出力は書き直したテキストのみにしてください。\n\nテキスト: ${inputText}`;
    try {
      const refined = await callGemini(prompt);
      if (refined) setInputText(refined.trim());
    } catch (e) {
      console.error("Refine error", e);
    } finally {
      setIsRefining(false);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('会話履歴をすべて削除しますか？')) return;
    try {
      const q = collection(db, 'artifacts', appId, 'public', 'data', collectionName);
      const snapshot = await getDocs(q);
      const batch = writeBatch(db);
      snapshot.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } catch (e) {
      console.error("Error clearing:", e);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-100 overflow-hidden">
      {errorMsg && <div className="bg-red-500 text-white px-4 py-2 text-sm text-center flex items-center justify-center gap-2 z-50"><AlertTriangle size={16} />{errorMsg}</div>}

      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex justify-between items-center shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"><ChevronLeft size={24} /></button>
          <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2"><span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>送信画面</h2>
        </div>
        <div className="flex items-center gap-3">
          {/* 通知音トグルボタン */}
          <button onClick={() => setSoundEnabled(!soundEnabled)} className={`p-2 rounded-full transition-all ${soundEnabled ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-300 hover:text-slate-500'}`}>
            {soundEnabled ? <Volume2 size={20}/> : <VolumeX size={20}/>}
          </button>
          
          <button onClick={handleClearHistory} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all" title="履歴を全削除"><Trash2 size={20} /></button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full hidden md:inline-block">{user.displayName}</span>
            {user.photoURL ? <img src={user.photoURL} alt="me" className="w-9 h-9 rounded-full border-2 border-white shadow-sm" /> : <div className="w-9 h-9 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-bold">{user.displayName ? user.displayName[0] : 'ME'}</div>}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
           <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2"><MessageSquare size={48} className="opacity-20" /><p>メッセージ履歴はありません</p></div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.user?.uid === user.uid;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} gap-2`}>
                {!isMe && <div className="flex-shrink-0 mt-1">{msg.user?.photoURL ? <img src={msg.user.photoURL} className="w-8 h-8 rounded-full" alt="User" /> : <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center"><User size={14} className="text-slate-500"/></div>}</div>}
                <div className={`max-w-[70%]`}>
                   {msg.user?.displayName && <div className={`text-[10px] text-slate-400 mb-1 ${isMe ? 'text-right mr-1' : 'ml-1'}`}>{msg.user.displayName}</div>}
                   <div className={`rounded-2xl px-4 py-3 ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-800 shadow-sm rounded-bl-none border border-slate-200'}`}>
                    {msg.type === 'emoji' ? <span className="text-4xl">{msg.text}</span> : <p className="whitespace-pre-wrap text-lg">{msg.text}</p>}
                   </div>
                   <span className={`text-xs block mt-1 opacity-70 ${isMe ? 'text-right' : 'text-left'}`}>{new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-white border-t p-4 md:p-6 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-10">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <button onClick={toggleListening} className={`flex items-center gap-2 px-6 py-2 rounded-full transition-all font-medium ${isListening ? 'bg-red-100 text-red-600 animate-pulse border border-red-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {isListening ? <Mic size={20} /> : <MicOff size={20} />}
                {isListening ? '聞き取り中...' : 'マイクOFF'}
              </button>
              {isListening && <span className="text-xs text-slate-500">話した内容が下に入力されます</span>}
            </div>
            <button onClick={() => setInputText('')} className="text-slate-400 hover:text-slate-600 flex items-center gap-1 text-sm"><RefreshCw size={14} /> クリア</button>
          </div>
          <div className="relative group">
            <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="ここに文字が表示されます。キーボードで編集も可能です。" className="w-full p-4 pr-14 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none h-32 text-lg leading-relaxed shadow-inner bg-slate-50" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}} />
            <div className="absolute bottom-4 right-4 flex gap-2">
              <button onClick={handleRefineText} disabled={!inputText.trim() || isRefining} title="AIで文章を整える" className="p-3 bg-purple-100 text-purple-600 rounded-full hover:bg-purple-200 disabled:opacity-50 transition-colors shadow-sm">{isRefining ? <span className="animate-spin">✨</span> : <Sparkles size={20} />}</button>
              <button onClick={handleSend} disabled={!inputText.trim()} className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transition-transform active:scale-95"><Send size={24} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 3. Receiver (Guest) Screen
const ReceiverScreen = ({ user, collectionName, onBack }: { user: any, collectionName: string, onBack: () => void }) => {
  const [latestMessage, setLatestMessage] = useState<Message | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [aiReplies, setAiReplies] = useState<string[]>([]);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);
  const [sentFeedback, setSentFeedback] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false); 
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  
  const presetReplies = ["了解しました", "ありがとうございます", "少々お待ちください", "OKです！", "確認します"];
  const emojis = ["👍", "👌", "🙆‍♂️", "🙅‍♂️", "🙏", "😊"];

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', appId, 'public', 'data', collectionName);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: Message[] = [];
      let hasNewMessageFromOthers = false;

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          text: data.text,
          role: data.role,
          type: data.type,
          user: data.user,
          timestamp: data.timestamp,
          createdAt: data.createdAt || 0
        });
      });

      // 新着チェック
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.user?.uid !== user.uid && !isInitialMount.current) {
            hasNewMessageFromOthers = true;
          }
        }
      });

      if (hasNewMessageFromOthers && soundEnabled) {
        notifyUser();
      }

      if (isInitialMount.current) {
        isInitialMount.current = false;
      }

      msgs.sort((a, b) => b.createdAt - a.createdAt);
      setMessages(msgs);
      setErrorMsg(null);

      const latestSenderMsg = msgs.find(m => m.role === 'sender');
      if (latestSenderMsg && latestSenderMsg.id !== latestMessage?.id) {
        setLatestMessage(latestSenderMsg);
        setAiReplies([]);
      } else if (!latestSenderMsg) {
        setLatestMessage(null);
      }
    }, (error) => {
      console.error("Error fetching messages:", error);
      if (error.code === 'permission-denied') {
        setErrorMsg("通信エラー: 権限がありません。Firestoreのルール設定を確認してください。");
      } else {
        setErrorMsg(`通信エラー: ${error.message}`);
      }
    });

    return () => unsubscribe();
  }, [user, collectionName, latestMessage, soundEnabled]);

  useEffect(() => {
    if (showHistory && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [showHistory, messages]);

  const handleGenerateAiReplies = async () => {
    if (!latestMessage || isGeneratingReplies) return;
    setIsGeneratingReplies(true);
    const prompt = `受信したメッセージに対して、短くて適切な返信候補を3つ生成してください。
    返信はJSON配列形式（例: ["候補1", "候補2", "候補3"]）のみを出力し、余計な説明は含めないでください。
    受信メッセージ: "${latestMessage.text}"`;
    try {
      const result = await callGemini(prompt);
      const jsonMatch = result.match(/\[.*\]/s);
      if (jsonMatch) {
        const replies = JSON.parse(jsonMatch[0]);
        if (Array.isArray(replies)) setAiReplies(replies.slice(0, 3));
      }
    } catch (e) {
      console.error("AI Reply Gen Error", e);
    } finally {
      setIsGeneratingReplies(false);
    }
  };

  const handleReply = async (text: string, type: 'text' | 'emoji' | 'preset') => {
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', collectionName), {
        text: text,
        role: 'receiver',
        type: type,
        user: {
          uid: user.uid,
          displayName: user.displayName || '受信者',
          photoURL: user.photoURL
        },
        timestamp: serverTimestamp(),
        createdAt: Date.now()
      });
      setInputText('');
      setSentFeedback(text);
      setTimeout(() => setSentFeedback(null), 3000);
    } catch (e: any) {
      console.error("Error replying:", e);
      alert(`送信エラー: ${e.message}`);
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50 relative overflow-hidden">
       {errorMsg && <div className="bg-red-500 text-white px-4 py-2 text-sm text-center flex items-center justify-center gap-2 z-50 absolute top-0 w-full"><AlertTriangle size={16} />{errorMsg}</div>}
       <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-500 pointer-events-none ${sentFeedback ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
         <div className="bg-slate-800/90 backdrop-blur text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3"><CheckCircle2 className="text-green-400" size={20} /><div><span className="font-bold text-sm block">送信しました</span><span className="text-xs opacity-80 truncate max-w-[200px] block">{sentFeedback}</span></div></div>
       </div>

       <header className="bg-white border-b border-slate-100 px-4 py-3 flex justify-between items-center shadow-sm shrink-0 z-10 h-16">
         <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-slate-500 flex items-center gap-1 text-sm font-medium hover:text-indigo-600 transition-colors"><ChevronLeft size={18}/></button>
            <button onClick={() => setShowHistory(!showHistory)} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${showHistory ? 'bg-slate-800 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{showHistory ? <X size={14}/> : <History size={14}/>}{showHistory ? '閉じる' : '履歴'}</button>
            
            {/* 通知音トグルボタン */}
            <button onClick={() => setSoundEnabled(!soundEnabled)} className={`p-2 rounded-full transition-all ${soundEnabled ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-300 hover:text-slate-500'}`}>
              {soundEnabled ? <Volume2 size={18}/> : <VolumeX size={18}/>}
            </button>
         </div>
         <div className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full">
             <div className="flex items-center gap-2"><span className="text-xs font-bold text-indigo-600 hidden md:inline-block">{user.displayName}</span>{user.photoURL ? <img src={user.photoURL} alt="me" className="w-6 h-6 rounded-full" /> : <div className="w-6 h-6 bg-indigo-200 rounded-full flex items-center justify-center text-[10px] font-bold text-indigo-700">{user.displayName ? user.displayName[0] : 'G'}</div>}</div>
         </div>
       </header>

       <main className="flex-1 overflow-y-auto p-4 flex flex-col relative" style={{backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px'}}>
         {showHistory ? (
            <div className="flex-1 space-y-6 pb-4 animate-fade-in">
                {[...messages].reverse().map((msg) => { 
                    const isMe = msg.user?.uid === user.uid;
                    return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} gap-3`}>
                        {!isMe && <div className="flex-shrink-0 mt-auto">{msg.user?.photoURL ? <img src={msg.user.photoURL} className="w-8 h-8 rounded-full shadow-sm" alt="User" /> : <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">{msg.user?.displayName?.[0] || 'G'}</div>}</div>}
                        <div className={`max-w-[80%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            {msg.user?.displayName && <span className={`text-[10px] text-slate-400 mb-1 ${isMe ? 'mr-1' : 'ml-1'}`}>{msg.user.displayName}</span>}
                            <div className={`px-4 py-2 shadow-sm relative text-sm ${isMe ? 'bg-indigo-600 text-white rounded-2xl rounded-br-none' : 'bg-white text-slate-800 border border-slate-100 rounded-2xl rounded-bl-none'}`}>{msg.type === 'emoji' ? <span className="text-3xl block p-1">{msg.text}</span> : <p className="whitespace-pre-wrap">{msg.text}</p>}</div>
                            <span className="text-[10px] text-slate-400 mt-1 px-1">{new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                    </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>
         ) : (
            <div className="flex-1 flex flex-col items-center justify-center h-full">
                {latestMessage ? (
                <div className="w-full max-w-2xl animate-float relative z-0 flex flex-col justify-center">
                    <div className="flex items-center justify-center gap-2 mb-4 opacity-80">
                    {latestMessage.user?.photoURL ? <img src={latestMessage.user.photoURL} className="w-8 h-8 rounded-full shadow-sm" alt="Sender" /> : <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">{latestMessage.user?.displayName?.[0] || 'S'}</div>}
                    <span className="text-sm font-bold text-slate-600">{latestMessage.user?.displayName || '送信者'}</span>
                    <span className="text-xs text-slate-400 bg-white px-2 py-1 rounded-full shadow-sm">{new Date(latestMessage.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                    </div>
                    <div className="bg-white/80 backdrop-blur-sm rounded-[2.5rem] p-6 md:p-10 shadow-2xl border border-white/50 text-center relative overflow-hidden group mx-2">
                    <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400"></div>
                    <p className="text-2xl sm:text-4xl md:text-6xl font-bold text-slate-800 leading-snug break-words drop-shadow-sm">{latestMessage.text}</p>
                    </div>
                </div>
                ) : (
                <div className="text-slate-400 text-xl font-medium flex flex-col items-center gap-4 animate-pulse"><div className="w-24 h-24 bg-slate-200 rounded-full flex items-center justify-center"><MessageSquare size={40} className="text-white" /></div>メッセージを待機中...</div>
                )}
            </div>
         )}
       </main>

       <div className="bg-white border-t border-slate-100 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] z-10 rounded-t-[2rem] pb-safe">
         <div className="max-w-3xl mx-auto pb-4 pt-2">
            <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-2 mt-2"></div>
            <div className="px-3 space-y-3">
              {latestMessage && (
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar items-center pl-1">
                   <button onClick={handleGenerateAiReplies} disabled={isGeneratingReplies || aiReplies.length > 0} className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold shrink-0 transition-all shadow-sm ${aiReplies.length > 0 ? 'bg-purple-50 text-purple-400 cursor-default border border-purple-100' : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white'}`}>{isGeneratingReplies ? <span className="animate-spin">✨</span> : <Wand2 size={14} />}{aiReplies.length > 0 ? '完了' : 'AI返信'}</button>
                   {aiReplies.map((reply, idx) => (<button key={idx} onClick={() => handleReply(reply, 'preset')} className="shrink-0 px-4 py-2 bg-white border border-purple-100 text-purple-700 rounded-xl text-xs font-bold shadow-sm whitespace-nowrap">✨ {reply}</button>))}
                </div>
              )}
              <div className="flex justify-between gap-1 overflow-x-auto pb-1 no-scrollbar">{emojis.map((emoji) => (<button key={emoji} onClick={() => handleReply(emoji, 'emoji')} className="text-3xl p-2 hover:bg-slate-50 rounded-xl transition-transform active:scale-90">{emoji}</button>))}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{presetReplies.map((reply) => (<button key={reply} onClick={() => handleReply(reply, 'preset')} className="py-3 px-2 bg-slate-50 text-slate-600 font-bold rounded-xl border border-transparent active:scale-95 text-xs md:text-sm">{reply}</button>))}</div>
              <div className="flex gap-2 pt-1"><input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="メッセージ..." className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-100 bg-slate-50 focus:bg-white focus:border-indigo-400 outline-none transition-all text-sm" /><button onClick={() => handleReply(inputText, 'text')} disabled={!inputText.trim()} className="bg-slate-800 text-white px-4 rounded-xl font-bold disabled:opacity-30"><Send size={18} /></button></div>
            </div>
         </div>
       </div>
    </div>
  );
};

// 4. Main App Container
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<Role>(null);
  const [isLoading, setIsLoading] = useState(true);
  const collectionName = 'live_transcription_chat_v3_style';

  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } 
      setIsLoading(false);
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (isLoading) {
    return <div className="h-screen flex items-center justify-center text-slate-500 bg-slate-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  if (!user) {
    return <LoginScreen setUser={setUser} />;
  }

  if (!role) {
    return <RoleSelector onSelect={setRole} user={user} />;
  }

  return (
    <>
      <style>{`.no-scrollbar::-webkit-scrollbar { display: none; } .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
      {role === 'sender' ? <SenderScreen user={user} collectionName={collectionName} onBack={() => setRole(null)} /> : <ReceiverScreen user={user} collectionName={collectionName} onBack={() => setRole(null)} />}
    </>
  );
}