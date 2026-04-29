"use client";

// ─────────────────────────────────────────────────────────────────────────────
//  FinIntel · Dashboard v4 (Premium UI)
//  Fully aligned with FastAPI backend (main.py v2.1.0)
//  Firebase Auth + Firestore for portfolio/alerts/watchlist persistence
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast, { Toaster } from "react-hot-toast";
import {
  Search, X, Star, Bell, BarChart2, TrendingUp, TrendingDown,
  RefreshCw, ExternalLink, Command, Plus, Trash2, AlertCircle,
  ChevronDown, ArrowRight, ArrowUp, ArrowDown,
  Globe, Clock, GitCompare, Briefcase,
  BellOff, CheckCircle2, Minus, ShieldCheck, ShieldAlert,
  Newspaper, Sparkles, BookOpen, LogOut,
} from "lucide-react";
import {
  Chart as ChartJS, LineElement, PointElement, LinearScale,
  CategoryScale, Tooltip, Filler, Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

// Firebase — adjust these paths to your project setup
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider,
  signInWithPopup, signOut, User as FirebaseUser,
} from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc,
  arrayUnion, arrayRemove, collection, addDoc, deleteDoc,
  onSnapshot,
} from "firebase/firestore";

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler, Legend);

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE INIT  (reads from env vars — set in .env.local)
// ─────────────────────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

type View   = "dashboard" | "portfolio" | "alerts" | "compare";
type Period = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

const PERIOD_DAYS: Record<Period, number> = {
  "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "ALL": Infinity,
};
const PERIODS: Period[]   = ["1W", "1M", "3M", "6M", "1Y", "ALL"];
const COMPARE_COLORS       = ["#3b82f6", "#34d399", "#f59e0b", "#a78bfa", "#fb7185"];
const POPULAR              = ["AAPL", "NVDA", "MSFT", "TSLA", "RELIANCE.NS", "TCS.NS", "GOOGL", "INFY.NS"];

// ─────────────────────────────────────────────────────────────────────────────
// TYPES  — aligned with backend schemas
// ─────────────────────────────────────────────────────────────────────────────

interface SearchResult {
  symbol: string; name?: string; exchange?: string; type?: string;
}

interface NewsItem {
  id?: string | number;
  title: string;
  text?: string;
  url?: string;
  link?: string;
  source?: string;
  time?: string;
  date?: string;
  sentiment?: string;
}

interface PricePoint { date: string; close: number; }

interface StockData {
  symbol: string;
  name?: string;
  company_name?: string;
  sector?: string; industry?: string;
  website?: string; currency?: string;
  prices: PricePoint[];
  final_score: number;
  sentiment_score: number;
  risk_score?: number;
  technical_score: number;
  fundamental_score?: number;
  technical_signal?: string;
  decision?: string;
  explanation: string;
  cached?: boolean;
  generated_at?: number;
  fundamentals: {
    roe?: number | null;
    debt_equity?: number | null;
    revenue_growth?: number | null;
    profit_margin?: number | null;
    market_cap?: number | null;
    pe_ratio?: number | null;
    eps?: number | null;
    beta?: number | null;
    dividend_yield?: number | null;
    avg_volume?: number | null;
    sector?: string | null;
    industry?: string | null;
    name?: string | null;
    website?: string | null;
    "52w_high"?: number | null;
    "52w_low"?: number | null;
  };
}

interface PortfolioHolding {
  id?: string;
  symbol: string;
  quantity: number;
  price: number;
  current_price?: number;
  pnl?: number;
  pnl_percent?: number;
  added_at?: number;
  logoUrl?: string;
  companyName?: string;
}

interface AlertItem {
  id?: string;
  symbol: string;
  target_price: number;
  condition: "above" | "below";
  triggered?: boolean;
  created_at?: number;
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function getCurrencySymbol(symbol: string, currencyCode?: string | null): string {
  const s = symbol.toUpperCase();
  if (currencyCode === "INR" || s.endsWith(".NS") || s.endsWith(".BO")) return "₹";
  if (currencyCode === "EUR") return "€";
  if (currencyCode === "GBP") return "£";
  return "$";
}

function fmtNum(n: number | null | undefined, type = "number", prefix = "", decimals = 2): string {
  if (n == null || isNaN(n) || !isFinite(n)) return "N/A";
  if (type === "large") {
    if (Math.abs(n) >= 1e12) return `${prefix}${(n / 1e12).toFixed(1)}T`;
    if (Math.abs(n) >= 1e9)  return `${prefix}${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6)  return `${prefix}${(n / 1e6).toFixed(1)}M`;
    return `${prefix}${n.toLocaleString()}`;
  }
  if (type === "pct") return `${n > 0 ? "+" : ""}${n.toFixed(decimals)}%`;
  return `${prefix}${n.toFixed(decimals)}`;
}

function fmtDate(raw?: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    const diffH = Math.floor((Date.now() - d.getTime()) / 3_600_000);
    if (diffH < 1) return "Just now";
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return raw; }
}

function normSentiment(s?: string | null): "bullish" | "bearish" | "neutral" | undefined {
  if (!s) return undefined;
  const l = s.toLowerCase();
  if (l.includes("bull") || l === "positive") return "bullish";
  if (l.includes("bear") || l === "negative") return "bearish";
  return "neutral";
}

function useDebounce<T>(val: T, ms: number): T {
  const [dv, setDv] = useState(val);
  useEffect(() => { const t = setTimeout(() => setDv(val), ms); return () => clearTimeout(t); }, [val, ms]);
  return dv;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

function useFirebaseAuth() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, u => { setUser(u); setLoading(false); });
    return unsub;
  }, []);

  const signIn = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(firebaseAuth, provider);
      toast.success("Signed in!");
    } catch (e: any) {
      toast.error(e.message || "Sign in failed");
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(firebaseAuth);
    toast.success("Signed out");
  }, []);

  return { user, loading, signIn, signOut: signOutUser };
}

function useWatchlist(uid?: string) {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    if (!uid) { setList([]); return; }
    const ref = doc(db, "users", uid);
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) setList(snap.data().watchlist || []);
    });
    return unsub;
  }, [uid]);

  const toggle = useCallback(async (sym: string) => {
    if (!uid) { toast.error("Sign in to use watchlist"); return; }
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    const cur: string[] = snap.exists() ? (snap.data().watchlist || []) : [];
    if (cur.includes(sym)) {
      await setDoc(ref, { watchlist: arrayRemove(sym) }, { merge: true });
      toast.success(`Removed ${sym} from watchlist`);
    } else {
      await setDoc(ref, { watchlist: arrayUnion(sym) }, { merge: true });
      toast.success(`Added ${sym} to watchlist`);
    }
  }, [uid]);

  return { list, toggle };
}

function useFirestorePortfolio(uid?: string) {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uid) { setHoldings([]); return; }
    setLoading(true);
    const q = collection(db, "users", uid, "portfolio");
    const unsub = onSnapshot(q, snap => {
      setHoldings(snap.docs.map(d => ({ id: d.id, ...d.data() } as PortfolioHolding)));
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  const add = useCallback(async (h: Omit<PortfolioHolding, "id">) => {
    if (!uid) { toast.error("Sign in to manage portfolio"); return; }
    await addDoc(collection(db, "users", uid, "portfolio"), {
      ...h, added_at: Date.now(),
    });
    await fetch(`${API}/portfolio/add`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: h.symbol, quantity: h.quantity, price: h.price }),
    }).catch(() => {});
  }, [uid]);

  const remove = useCallback(async (id: string, symbol: string) => {
    if (!uid) return;
    await deleteDoc(doc(db, "users", uid, "portfolio", id));
    await fetch(`${API}/portfolio/remove/${symbol}`, { method: "DELETE" }).catch(() => {});
    toast.success(`Removed ${symbol}`);
  }, [uid]);

  return { holdings, loading, add, remove };
}

function useFirestoreAlerts(uid?: string) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uid) { setAlerts([]); return; }
    setLoading(true);
    const q = collection(db, "users", uid, "alerts");
    const unsub = onSnapshot(q, snap => {
      setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AlertItem)));
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  const add = useCallback(async (a: Omit<AlertItem, "id">) => {
    if (!uid) { toast.error("Sign in to create alerts"); return; }
    await addDoc(collection(db, "users", uid, "alerts"), {
      ...a, triggered: false, created_at: Date.now(),
    });
    toast.success(`Alert set for ${a.symbol}`);
  }, [uid]);

  const remove = useCallback(async (id: string) => {
    if (!uid) return;
    await deleteDoc(doc(db, "users", uid, "alerts", id));
    toast.success("Alert removed");
  }, [uid]);

  return { alerts, loading, add, remove };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED MICRO-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const Sk = ({ className }: { className?: string }) => (
  <div className={`relative overflow-hidden bg-white/[0.04] rounded-xl ${className}`}>
    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.07] to-transparent animate-[shimmer_1.5s_infinite]" />
  </div>
);

const Tag = ({ children, color = "blue" }: { children: React.ReactNode; color?: string }) => {
  const cls: Record<string, string> = {
    blue:   "bg-blue-500/10 text-blue-400 border-blue-500/20",
    green:  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    red:    "bg-rose-500/10 text-rose-400 border-rose-500/20",
    amber:  "bg-amber-500/10 text-amber-400 border-amber-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    gray:   "bg-white/[0.04] text-gray-500 border-white/[0.08]",
  };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider whitespace-nowrap ${cls[color] ?? cls.gray}`}>{children}</span>;
};

const SentimentTag = ({ s }: { s?: string }) => {
  if (!s) return null;
  const n = normSentiment(s);
  const map = { bullish: "green", bearish: "red", neutral: "amber" } as const;
  const label = { bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" } as const;
  if (!n) return null;
  return <Tag color={map[n]}>{label[n]}</Tag>;
};

const StockLogo = ({ symbol, size = 10 }: { symbol: string; size?: number }) => {
  const [err, setErr] = useState(false);
  const clean = symbol.split(".")[0].split("-")[0].toLowerCase();
  const dim = size <= 8 ? "w-8 h-8" : size <= 10 ? "w-10 h-10" : size <= 12 ? "w-12 h-12" : "w-16 h-16";

  if (err) return (
    <div className={`${dim} rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-xs font-black text-blue-400 shrink-0`}>
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );
  return (
    <img
      src={`https://logo.clearbit.com/${clean}.com`}
      alt={symbol}
      onError={() => setErr(true)}
      className={`${dim} rounded-xl object-cover shrink-0 border border-white/[0.06] bg-white/5`}
    />
  );
};

const Bar = ({ value, color = "bg-blue-500", h = "h-1.5" }: { value: number; color?: string; h?: string }) => (
  <div className={`w-full bg-black/40 ${h} rounded-full overflow-hidden`}>
    <motion.div
      initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, (value || 0) * 100))}%` }}
      transition={{ duration: 0.9, ease: "easeOut" }}
      className={`${h} rounded-full ${color}`}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// LOADERS
// ─────────────────────────────────────────────────────────────────────────────

const AnalysisLoader = ({ symbol }: { symbol: string }) => {
  const steps = [
    { icon: "📡", label: "Fetching market data", delay: 0 },
    { icon: "📊", label: "Running technical model", delay: 0.6 },
    { icon: "📰", label: "Scraping & scoring news", delay: 1.2 },
    { icon: "🏦", label: "Analysing fundamentals", delay: 1.8 },
    { icon: "🤖", label: "Fusing AI signals", delay: 2.4 },
  ];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const ids = steps.map((s, i) => setTimeout(() => setStep(i + 1), s.delay * 1000));
    return () => ids.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-8">
      <div className="relative w-24 h-24">
        <div className="absolute inset-0 rounded-full border-4 border-white/5" />
        <div className="absolute inset-0 rounded-full border-4 border-t-blue-500 border-r-blue-500/50 border-b-transparent border-l-transparent animate-spin" />
        <div className="absolute inset-3 rounded-full border-4 border-t-transparent border-r-transparent border-b-purple-500 border-l-purple-500/50 animate-spin" style={{ animationDirection: "reverse", animationDuration: "0.8s" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <StockLogo symbol={symbol} size={8} />
        </div>
      </div>

      <div className="text-center">
        <h3 className="text-xl font-black tracking-tight mb-1 text-white">Analysing <span className="text-blue-400">{symbol}</span></h3>
        <p className="text-gray-500 text-sm">Running multi-model AI pipeline…</p>
      </div>

      <div className="space-y-2 w-full max-w-xs">
        {steps.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: i < step ? 1 : 0.25, x: 0 }}
            transition={{ delay: s.delay, duration: 0.4 }}
            className="flex items-center gap-3 text-sm"
          >
            <span className="text-base">{s.icon}</span>
            <span className={i < step ? "text-white font-semibold" : "text-gray-600"}>{s.label}</span>
            {i < step && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-auto text-emerald-400">
                <CheckCircle2 size={14} />
              </motion.span>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// NEW: PROGRESSIVE AI NARRATIVE FEED
// ─────────────────────────────────────────────────────────────────────────────

function AINarrativeFeed({ news, stock }: { news: NewsItem[]; stock: StockData }) {
  const bullets = useMemo(() => {
    const points: { icon: string; text: string; tag: string; color: string }[] = [];
    const sent = stock.sentiment_score || 0.5;
    const signal = (stock.technical_signal || stock.decision || "HOLD").toUpperCase();

    if (news.length > 0) {
      const recent = news.slice(0, 3);
      recent.forEach(n => {
        const isPositive = normSentiment(n.sentiment) === "bullish";
        const isNegative = normSentiment(n.sentiment) === "bearish";
        if (n.title && n.title.length > 10) {
          points.push({
            icon: isPositive ? "📈" : isNegative ? "📉" : "📰",
            text: n.title,
            tag: isPositive ? "Catalyst" : isNegative ? "Risk" : "News",
            color: isPositive ? "text-emerald-400" : isNegative ? "text-rose-400" : "text-blue-400",
          });
        }
      });
    }

    if (signal === "BUY" || signal.includes("BUY")) {
      points.push({ icon: "⚡", text: "Technical indicators signal bullish momentum — MA crossover detected", tag: "Technical", color: "text-emerald-400" });
    } else if (signal === "SELL" || signal.includes("SELL")) {
      points.push({ icon: "⚠️", text: "Technical models indicate bearish pressure on near-term price action", tag: "Technical", color: "text-rose-400" });
    }

    if (sent > 0.7) {
      points.push({ icon: "🔥", text: "High positive news volume is driving bullish sentiment around this stock", tag: "Sentiment", color: "text-amber-400" });
    } else if (sent < 0.3) {
      points.push({ icon: "❄️", text: "Negative news sentiment is weighing on investor confidence", tag: "Sentiment", color: "text-rose-400" });
    }

    const f = stock.fundamentals;
    if (f.roe && f.roe > 20) {
      points.push({ icon: "💎", text: `Strong ROE of ${f.roe.toFixed(1)}% signals efficient capital utilisation`, tag: "Fundamental", color: "text-blue-400" });
    }
    if (f.revenue_growth && f.revenue_growth > 15) {
      points.push({ icon: "🚀", text: `Revenue growing at ${f.revenue_growth.toFixed(1)}% YoY — above sector average`, tag: "Growth", color: "text-purple-400" });
    }

    return points.slice(0, 5);
  }, [news, stock]);

  if (!bullets.length) return null;

  return (
    <div className="relative pl-4 border-l border-white/[0.05] space-y-6 mt-4">
      {bullets.map((b, i) => (
        <motion.div 
          key={i} 
          initial={{ opacity: 0, x: -10 }} 
          animate={{ opacity: 1, x: 0 }} 
          transition={{ delay: i * 0.1, ease: "easeOut" }}
          className="relative"
        >
          <div className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-[#0B0F14] border border-[#0B0F14] ${
            b.tag === "Catalyst" || b.tag === "Technical" ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]" : 
            b.tag === "Risk" ? "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.4)]" : "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]"
          }`} />
          
          <div className="flex items-start gap-3 bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.03] p-4 rounded-2xl backdrop-blur-md transition-colors cursor-default">
            <span className="text-xl shrink-0">{b.icon}</span>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-black uppercase tracking-wider ${b.color}`}>{b.tag}</span>
                <span className="text-[10px] text-gray-600">Just now</span>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{b.text}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL DETAILED ANALYSIS REPORT
// ─────────────────────────────────────────────────────────────────────────────

function DetailedReport({ stock }: { stock: StockData }) {
  const [open, setOpen] = useState(false);
  const decision = stock.decision || (stock.final_score >= 0.68 ? "BUY" : stock.final_score < 0.38 ? "SELL" : "HOLD");

  const sections = [
    {
      icon: "⚡", title: "Technical Analysis",
      content: `Technical Score: ${((stock.technical_score || 0) * 100).toFixed(0)}% — Signal: ${stock.technical_signal || "HOLD"}.\n` +
        (stock.technical_score > 0.65
          ? "Momentum indicators are constructive. Moving average crossovers suggest near-term upside, with RSI in a healthy range indicating room before overbought territory."
          : stock.technical_score < 0.35
          ? "Technical structure is deteriorating. Price action has broken key support levels and oscillators are in oversold territory — a bounce is possible but trend remains bearish."
          : "Mixed technical signals. The stock is consolidating within a range. Watch for a decisive break above resistance to confirm bullish continuation, or a breakdown to confirm bearish pressure."),
    },
    {
      icon: "📰", title: "Sentiment Analysis",
      content: `Sentiment Score: ${((stock.sentiment_score || 0) * 100).toFixed(0)}%.\n` +
        (stock.sentiment_score > 0.6
          ? "Recent news coverage is predominantly positive, with multiple catalysts noted across financial and industry sources. Social media and analyst commentary appear supportive."
          : stock.sentiment_score < 0.4
          ? "News flow has turned negative with multiple risk-related headlines. Investor confidence appears to be weakening based on volume and tone of recent coverage."
          : "Neutral news backdrop — no major catalysts identified. The stock is trading on fundamentals and technicals without significant external narrative pressure."),
    },
    {
      icon: "🏦", title: "Fundamental Analysis",
      content: `Fundamental Score: ${((stock.fundamental_score || 0) * 100).toFixed(0)}%.\n` +
        (stock.fundamentals.roe ? `ROE of ${stock.fundamentals.roe.toFixed(1)}% ` + (stock.fundamentals.roe > 15 ? "indicates strong management efficiency." : "is below sector benchmark.") + " " : "") +
        (stock.fundamentals.debt_equity ? `Debt/Equity ratio of ${stock.fundamentals.debt_equity.toFixed(2)}x ` + (stock.fundamentals.debt_equity < 1 ? "reflects a conservatively levered balance sheet." : "warrants monitoring as leverage is elevated.") + " " : "") +
        (stock.fundamentals.profit_margin ? `Net profit margin stands at ${stock.fundamentals.profit_margin.toFixed(1)}%.` : ""),
    },
    {
      icon: "🎯", title: "Final Verdict",
      content: `Overall Score: ${((stock.final_score || 0) * 100).toFixed(0)}% → Decision: ${decision}.\n` +
        (stock.explanation || "The AI pipeline has fused technical, fundamental, and sentiment signals into a composite score. Trade sizing should reflect individual risk tolerance and portfolio context. This is not financial advice."),
    },
  ];

  return (
    <div className="bg-[#0B0F14]/50 border border-white/[0.05] rounded-3xl overflow-hidden backdrop-blur-2xl">
      <button onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between p-6 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <BookOpen size={16} className="text-blue-400" />
          </div>
          <p className="text-xs text-white uppercase font-black tracking-widest">Full Detailed Analysis Report</p>
        </div>
        <ChevronDown size={16} className={`text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
            <div className="px-6 pb-6 space-y-6 border-t border-white/[0.05] pt-6">
              
              <div className={`flex items-center gap-4 p-5 rounded-2xl border ${
                decision.includes("BUY")  ? "bg-emerald-500/10 border-emerald-500/20" :
                decision.includes("SELL") ? "bg-rose-500/10 border-rose-500/20"       :
                "bg-amber-500/10 border-amber-500/20"
              }`}>
                <div className={`text-3xl font-black ${
                  decision.includes("BUY")  ? "text-emerald-400" :
                  decision.includes("SELL") ? "text-rose-400" : "text-amber-400"
                }`}>
                  {decision.includes("BUY") ? "📈" : decision.includes("SELL") ? "📉" : "➡️"}
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-black">AI Verdict</p>
                  <p className={`text-2xl font-black ${
                    decision.includes("BUY")  ? "text-emerald-400" :
                    decision.includes("SELL") ? "text-rose-400" : "text-amber-400"
                  }`}>{decision}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-black">Confidence</p>
                  <p className="text-2xl font-black text-white">{((stock.final_score || 0) * 100).toFixed(0)}%</p>
                </div>
              </div>

              {sections.map((sec, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                  className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.03]">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xl">{sec.icon}</span>
                    <p className="text-sm font-black text-white">{sec.title}</p>
                  </div>
                  {sec.content.split("\n").map((line, j) => (
                    <p key={j} className="text-sm text-gray-400 leading-relaxed mb-1.5">{line}</p>
                  ))}
                </motion.div>
              ))}

              <p className="text-[10px] text-gray-600 leading-relaxed border-t border-white/[0.04] pt-4">
                ⚠️ This report is generated by AI models and is for informational purposes only. It does not constitute financial advice. Always do your own research before making investment decisions.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE CHART
// ─────────────────────────────────────────────────────────────────────────────

function PriceChart({ data, symbol, cs = "$" }: { data: PricePoint[]; symbol: string; cs?: string }) {
  const [period, setPeriod] = useState<Period>("3M");

  const filtered = useMemo(() => {
    if (!data?.length) return [];
    if (period === "ALL") return data;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PERIOD_DAYS[period]);
    return data.filter(d => new Date(d.date) >= cutoff);
  }, [data, period]);

  const { isUp, changePct } = useMemo(() => {
    if (filtered.length < 2) return { isUp: true, changePct: 0 };
    const first = filtered[0].close, last = filtered.at(-1)!.close;
    if (!first) return { isUp: true, changePct: 0 };
    return { isUp: last >= first, changePct: ((last - first) / first) * 100 };
  }, [filtered]);

  if (!data?.length) return (
    <div className="h-72 flex items-center justify-center text-gray-600 text-sm">
      No price data available
    </div>
  );

  const lc = isUp ? "#34d399" : "#fb7185";
  const chartData = {
    labels: filtered.map(d => new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })),
    datasets: [{
      data: filtered.map(d => d.close),
      borderColor: lc,
      backgroundColor: (ctx: any) => {
        const g = ctx.chart.canvas.getContext("2d").createLinearGradient(0, 0, 0, 300);
        g.addColorStop(0, isUp ? "rgba(52,211,153,0.15)" : "rgba(251,113,133,0.15)");
        g.addColorStop(1, "transparent");
        return g;
      },
      fill: true, borderWidth: 2.5, tension: 0.35, pointRadius: 0,
      pointHoverRadius: 6, pointHoverBackgroundColor: lc, pointHoverBorderColor: "#fff", pointHoverBorderWidth: 2,
    }],
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">Price Trend</p>
          {filtered.length > 0 && (
            <div className="flex items-baseline gap-3">
              <p className="text-3xl font-black text-white">{cs}{filtered.at(-1)!.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <span className={`flex items-center gap-1 text-sm font-black ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {changePct >= 0 ? "+" : ""}{isNaN(changePct) ? "0.00" : changePct.toFixed(2)}%
                <span className="text-gray-600 text-xs font-semibold ml-1">({period})</span>
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-1 bg-white/[0.03] border border-white/[0.05] rounded-xl p-1 backdrop-blur-md">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${period === p ? "bg-white text-[#0B0F14] shadow-md" : "text-gray-500 hover:text-white hover:bg-white/[0.05]"}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 300 }}>
        <Line data={chartData} options={{
          responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "rgba(11, 15, 20, 0.9)", borderColor: "rgba(255,255,255,0.1)", borderWidth: 1,
              padding: 12, titleColor: "#9ca3af", bodyColor: "#fff", displayColors: false,
              titleFont: { size: 12, family: "inherit" }, bodyFont: { size: 14, weight: "bold", family: "inherit" },
              callbacks: {
                title: (i: any[]) => i[0]?.label,
                label: (i: any) => `${cs}${i.parsed.y >= 1000 ? i.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2 }) : i.parsed.y.toFixed(2)}`,
              },
            },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: "#4b5563", maxTicksLimit: 6, font: { size: 11, weight: "bold" }, maxRotation: 0 } },
            y: { grid: { color: "rgba(255,255,255,0.03)" }, border: { display: false }, position: "right",
              ticks: { color: "#4b5563", font: { size: 11, weight: "bold" }, callback: (v: any) => v >= 1000 ? `${cs}${(v / 1000).toFixed(1)}k` : `${cs}${v}` } },
          },
          interaction: { mode: "index", intersect: false },
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWS PANEL
// ─────────────────────────────────────────────────────────────────────────────

function NewsPanel({ news }: { news: NewsItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? news : news.slice(0, 4);

  return (
    <div className="bg-[#0B0F14]/50 border border-white/[0.05] rounded-3xl p-6 backdrop-blur-2xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Newspaper size={16} className="text-blue-400" />
          </div>
          <p className="text-xs text-white uppercase font-black tracking-widest">Market News</p>
        </div>
      </div>

      {!news.length ? (
        <p className="text-gray-600 text-sm text-center py-8">No recent headlines found.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((n, i) => {
            const href = n.url?.trim() || n.link?.trim() || `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(n.title)}`;
            const displayTime = fmtDate(n.date || n.time);
            return (
              <a key={n.id ?? i} href={href} target="_blank" rel="noopener noreferrer"
                className="group flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-white/[0.01] border border-white/[0.03] hover:bg-white/[0.03] hover:border-white/[0.08] transition-all">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {n.source && <span className="text-[10px] font-black text-blue-400/80 uppercase tracking-wider">{n.source}</span>}
                    <SentimentTag s={n.sentiment} />
                  </div>
                  <p className="text-sm font-bold text-gray-300 group-hover:text-white transition-colors leading-snug">{n.title}</p>
                  {n.text && n.text !== n.title && <p className="text-xs text-gray-500 line-clamp-1 mt-1.5">{n.text}</p>}
                </div>
                <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                  {displayTime && <span className="text-[10px] text-gray-600 font-bold flex items-center gap-1"><Clock size={10} />{displayTime}</span>}
                  <div className="w-8 h-8 rounded-full bg-white/[0.03] flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-colors">
                     <ArrowRight size={14} className="text-gray-500 group-hover:text-white" />
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {news.length > 4 && (
        <button onClick={() => setExpanded(p => !p)}
          className="w-full mt-4 py-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.04] text-xs font-black text-gray-400 hover:text-white hover:bg-white/[0.05] transition-all flex items-center justify-center gap-2">
          {expanded ? "Show Less" : `Load ${news.length - 4} More Articles`} <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD TO PORTFOLIO MODAL
// ─────────────────────────────────────────────────────────────────────────────

function AddPortfolioModal({
  symbol, currentPrice, companyName, onClose, onAdd,
}: { symbol: string; currentPrice?: number; companyName?: string; onClose: () => void; onAdd: (h: Omit<PortfolioHolding, "id">) => Promise<void>; }) {
  const [qty, setQty]       = useState("1");
  const [price, setPrice]   = useState(currentPrice?.toFixed(2) || "");
  const [note, setNote]     = useState("");
  const [adding, setAdding] = useState(false);

  const totalCost = parseFloat(qty) * parseFloat(price);

  const handleAdd = async () => {
    if (!qty || !price || isNaN(+qty) || isNaN(+price) || +qty <= 0 || +price <= 0) {
      toast.error("Enter valid quantity and price");
      return;
    }
    setAdding(true);
    try {
      await onAdd({
        symbol: symbol.toUpperCase(),
        quantity: +qty,
        price: +price,
        companyName: companyName || symbol,
        current_price: currentPrice || +price,
      });
      toast.success(`${symbol} added to portfolio!`);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to add");
    }
    setAdding(false);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.94, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }} transition={{ type: "spring", stiffness: 400, damping: 35 }}
        className="bg-[#0B0F14] border border-white/10 rounded-3xl p-8 max-w-md w-full shadow-[0_40px_80px_rgba(0,0,0,0.8)]"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <StockLogo symbol={symbol} size={12} />
            <div>
              <h3 className="font-black text-xl">{symbol}</h3>
              {companyName && <p className="text-xs text-gray-500 font-medium">{companyName}</p>}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-gray-400 hover:text-white transition-colors"><X size={16} /></button>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">Quantity</label>
              <input type="number" value={qty} onChange={e => setQty(e.target.value)} min="0.001" step="1"
                className="w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-4 py-3.5 text-white text-sm outline-none focus:border-blue-500/50 transition-colors placeholder-gray-700 font-bold" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">Buy Price</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} min="0.01" step="0.01"
                className="w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-4 py-3.5 text-white text-sm outline-none focus:border-blue-500/50 transition-colors placeholder-gray-700 font-bold" />
            </div>
          </div>

          {!isNaN(totalCost) && totalCost > 0 && (
            <div className="p-4 rounded-2xl bg-blue-500/[0.05] border border-blue-500/15">
              <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mb-1">Total Cost</p>
              <p className="text-2xl font-black text-blue-400">{getCurrencySymbol(symbol)}{totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          )}

          <div>
            <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">Note (optional)</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Long-term hold"
              className="w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-4 py-3.5 text-white text-sm outline-none focus:border-blue-500/50 transition-colors placeholder-gray-700 font-bold" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleAdd} disabled={adding}
              className="flex-1 py-4 rounded-2xl bg-white text-[#0B0F14] hover:bg-gray-200 disabled:opacity-50 font-black text-sm transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]">
              {adding ? "Adding…" : "Add to Portfolio"}
            </button>
            <button onClick={onClose} className="px-6 py-4 rounded-2xl bg-white/[0.03] border border-white/[0.05] font-black text-sm text-gray-400 hover:text-white hover:bg-white/[0.05] transition-all">
              Cancel
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: STOCK ANALYSIS (The Premium Terminal View)
// ─────────────────────────────────────────────────────────────────────────────

function StockAnalysis({ symbol, user, onAddToPortfolio }: {
  symbol: string; user: FirebaseUser | null;
  onAddToPortfolio: (h: Omit<PortfolioHolding, "id">) => Promise<void>;
}) {
  const [showAddModal, setShowAddModal]  = useState(false);

  const { data: stock, isLoading, isError, refetch } = useQuery<StockData>({
    queryKey: ["stock", symbol],
    queryFn: async () => {
      const r = await fetch(`${API}/stock/${encodeURIComponent(symbol)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const { data: newsRaw } = useQuery({
    queryKey: ["news", symbol],
    queryFn: async () => {
      const r = await fetch(`${API}/news/${encodeURIComponent(symbol)}`);
      const j = await r.json();
      return (j.news || []).map((n: NewsItem, idx: number) => ({
        ...n,
        id: n.id ?? idx,
        time: fmtDate(n.date || n.time),
        sentiment: normSentiment(n.sentiment),
      }));
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) return <AnalysisLoader symbol={symbol} />;

  if (isError || !stock) return (
    <div className="p-8 bg-rose-500/[0.05] border border-rose-500/20 rounded-3xl flex items-start gap-4">
      <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
        <AlertCircle size={20} className="text-rose-400" />
      </div>
      <div>
        <p className="font-black text-rose-400 text-lg">Analysis failed for {symbol}</p>
        <p className="text-sm text-gray-400 mt-1">Symbol may be invalid or the market data provider is currently unavailable.</p>
        <button onClick={() => refetch()} className="mt-4 px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-sm font-bold text-rose-400 flex items-center gap-2 transition-colors">
          <RefreshCw size={14} /> Try Again
        </button>
      </div>
    </div>
  );

  const currentPrice = stock.prices?.at(-1)?.close;
  const prevPrice    = stock.prices?.at(-2)?.close;
  const dayChange    = currentPrice && prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : null;
  const cs           = getCurrencySymbol(symbol, stock.currency);
  const news: NewsItem[] = newsRaw || [];
  const decision     = stock.decision || (stock.final_score >= 0.68 ? "BUY" : stock.final_score < 0.38 ? "SELL" : "HOLD");

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="max-w-6xl mx-auto space-y-8 pb-20"
    >
      {/* 1. HERO SECTION */}
      <header className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 pb-6 border-b border-white/[0.05]">
        <div className="flex items-center gap-5">
          <StockLogo symbol={symbol} size={16} />
          <div>
            <div className="flex items-center gap-4 mb-2">
              <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-white">{symbol}</h1>
              <div className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border backdrop-blur-md ${
                decision === "BUY" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : 
                decision === "SELL" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : 
                "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}>
                AI Verdict: {decision}
              </div>
            </div>
            <p className="text-gray-400 font-medium text-base">{stock.company_name || stock.name}</p>
          </div>
        </div>

        {currentPrice != null && !isNaN(currentPrice) && (
          <div className="text-right">
            <p className="text-5xl font-black tracking-tighter text-white">
              {cs}{currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </p>
            {dayChange != null && (
              <p className={`text-sm font-black flex items-center justify-end gap-1.5 mt-1.5 ${dayChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {dayChange >= 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                {Math.abs(dayChange).toFixed(2)}% Today
              </p>
            )}
          </div>
        )}
      </header>

      {/* 2. KEY INSIGHTS SCROLLING BAR */}
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
        {[
          { label: "Market Cap", val: stock.fundamentals.market_cap ? fmtNum(stock.fundamentals.market_cap, "large", cs) : "N/A" },
          { label: "P/E Ratio", val: stock.fundamentals.pe_ratio ? `${stock.fundamentals.pe_ratio.toFixed(1)}x` : "N/A" },
          { label: "ROE", val: stock.fundamentals.roe != null ? `${stock.fundamentals.roe.toFixed(1)}%` : "N/A" },
          { label: "Beta", val: stock.fundamentals.beta ? stock.fundamentals.beta.toFixed(2) : "N/A" },
          { label: "Div Yield", val: stock.fundamentals.dividend_yield ? fmtNum(stock.fundamentals.dividend_yield * 100, "pct") : "N/A" },
          { label: "Volume", val: stock.fundamentals.avg_volume ? fmtNum(stock.fundamentals.avg_volume, "large") : "N/A" },
        ].map(stat => (
          <div key={stat.label} className="flex-shrink-0 bg-white/[0.02] border border-white/[0.04] rounded-2xl p-5 min-w-[140px] backdrop-blur-xl">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black mb-1.5">{stat.label}</p>
            <p className="text-xl font-black text-white">{stat.val}</p>
          </div>
        ))}
      </div>

      {/* 3. MAIN GRID (Chart + AI Signals) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Col: Chart & Narrative */}
        <div className="lg:col-span-8 space-y-8">
          <div className="bg-[#0B0F14]/50 border border-white/[0.05] rounded-3xl backdrop-blur-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
            <PriceChart data={stock.prices} symbol={symbol} cs={cs} />
          </div>

          <div className="bg-[#0B0F14]/50 border border-white/[0.05] rounded-3xl p-8 backdrop-blur-2xl">
            <div className="flex items-center gap-3 mb-6">
               <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
                 <Sparkles size={16} className="text-purple-400" />
               </div>
               <h3 className="text-xs font-black uppercase tracking-widest text-white">Market Intelligence Feed</h3>
            </div>
            <AINarrativeFeed news={news} stock={stock} />
          </div>
          
          <NewsPanel news={news} />
        </div>

        {/* Right Col: AI Stack */}
        <div className="lg:col-span-4 space-y-6">
           {/* Primary Verdict Card */}
           <div className="bg-gradient-to-br from-white/[0.04] to-transparent border border-white/[0.08] rounded-3xl p-8 relative overflow-hidden backdrop-blur-xl">
             <div className="absolute -top-16 -right-16 w-48 h-48 bg-blue-500/10 blur-[60px] rounded-full pointer-events-none" />
             <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mb-4">AI Confidence</p>
             <div className="text-6xl font-black text-white mb-4 tracking-tighter">
               {((stock.final_score || 0) * 100).toFixed(0)}%
             </div>
             <Bar value={stock.final_score || 0} color="bg-blue-500" h="h-2" />
             <p className="text-sm text-gray-400 mt-6 leading-relaxed font-medium">
               {stock.explanation || "Algorithms suggest a neutral stance pending further momentum confirmation."}
             </p>
           </div>

           {/* Stacked Sub-Signals */}
           <div className="grid grid-cols-2 gap-4">
             <div className="bg-white/[0.02] border border-white/[0.04] rounded-3xl p-6">
               <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-3">Technical</p>
               <p className="text-2xl font-black text-white">{((stock.technical_score || 0) * 100).toFixed(0)}%</p>
             </div>
             <div className="bg-white/[0.02] border border-white/[0.04] rounded-3xl p-6">
               <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-3">Sentiment</p>
               <p className="text-2xl font-black text-white">{((stock.sentiment_score || 0) * 100).toFixed(0)}%</p>
             </div>
           </div>

           <button 
             onClick={() => user ? setShowAddModal(true) : toast.error("Sign in to manage portfolio")}
             className="w-full py-5 rounded-2xl bg-white text-[#0B0F14] font-black text-sm hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)] flex items-center justify-center gap-2 mt-4"
           >
             <Plus size={16} /> Track in Portfolio
           </button>
           
           <DetailedReport stock={stock} />
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <AddPortfolioModal
            symbol={symbol}
            currentPrice={currentPrice}
            companyName={stock.company_name || stock.name !== symbol ? stock.company_name || stock.name : undefined}
            onClose={() => setShowAddModal(false)}
            onAdd={onAddToPortfolio}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO VIEW  — Firestore-backed
// ─────────────────────────────────────────────────────────────────────────────

function PortfolioView({ user, portfolio, onSelectSymbol }: {
  user: FirebaseUser | null;
  portfolio: ReturnType<typeof useFirestorePortfolio>;
  onSelectSymbol: (s: string) => void;
}) {
  const { holdings, loading, remove } = portfolio;
  const [showAdd, setShowAdd]         = useState(false);
  const [newSym, setNewSym]           = useState("");
  const [newQty, setNewQty]           = useState("");
  const [newPrc, setNewPrc]           = useState("");
  const [adding, setAdding]           = useState(false);

  const handleAdd = async () => {
    if (!newSym.trim() || !newQty || !newPrc) { toast.error("All fields required"); return; }
    if (isNaN(+newQty) || isNaN(+newPrc) || +newQty <= 0 || +newPrc <= 0) { toast.error("Enter valid numbers"); return; }
    setAdding(true);
    try {
      await portfolio.add({ symbol: newSym.trim().toUpperCase(), quantity: +newQty, price: +newPrc, companyName: newSym.toUpperCase() });
      setNewSym(""); setNewQty(""); setNewPrc(""); setShowAdd(false);
    } catch (e: any) { toast.error(e.message || "Failed"); }
    setAdding(false);
  };

  const summary = useMemo(() => {
    if (!holdings.length) return null;
    const totalInvested = holdings.reduce((s, h) => s + h.price * h.quantity, 0);
    const totalCurrent  = holdings.reduce((s, h) => s + (h.current_price || h.price) * h.quantity, 0);
    const totalPnl      = totalCurrent - totalInvested;
    return { totalInvested, totalCurrent, totalPnl, pnlPct: (totalPnl / totalInvested) * 100 };
  }, [holdings]);

  if (!user) return (
    <div className="py-32 text-center space-y-4">
      <div className="w-20 h-20 rounded-full bg-white/[0.02] border border-white/[0.05] flex items-center justify-center mx-auto">
        <Briefcase size={32} className="text-gray-600" />
      </div>
      <h2 className="text-xl font-black text-white">Portfolio Sync Required</h2>
      <p className="text-gray-500 text-sm">Sign in to track your investments and performance.</p>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-black tracking-tighter text-white mb-2">Portfolio</h2>
           <p className="text-sm text-gray-500 font-medium">{holdings.length} tracked assets</p>
        </div>
        <button onClick={() => setShowAdd(p => !p)}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-[#0B0F14] hover:bg-gray-200 font-black text-sm transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]">
          <Plus size={16} /> Add Position
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-[#0B0F14]/50 border border-white/[0.08] rounded-3xl p-8 space-y-6 backdrop-blur-2xl mb-8">
              <p className="text-xs font-black text-white uppercase tracking-widest">New Position</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {[
                  { label: "Symbol",   val: newSym,  set: (v: string) => setNewSym(v.toUpperCase()), ph: "AAPL", mono: true },
                  { label: "Quantity", val: newQty,  set: setNewQty,  ph: "10",      type: "number" },
                  { label: "Buy Price",val: newPrc,  set: setNewPrc,  ph: "150.00", type: "number" },
                ].map(f => (
                  <div key={f.label}>
                    <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">{f.label}</label>
                    <input value={f.val} onChange={e => f.set(e.target.value)} type={f.type || "text"} placeholder={f.ph}
                      className={`w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-4 py-3.5 text-white text-sm outline-none focus:border-blue-500/50 placeholder-gray-700 transition-colors font-bold ${f.mono ? "font-mono" : ""}`} />
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={handleAdd} disabled={adding}
                  className="px-8 py-3.5 rounded-2xl bg-white text-[#0B0F14] hover:bg-gray-200 disabled:opacity-50 font-black text-sm transition-all">
                  {adding ? "Adding…" : "Add to Portfolio"}
                </button>
                <button onClick={() => setShowAdd(false)} className="px-8 py-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.05] font-black text-sm text-gray-400 hover:text-white transition-all">
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-4">{[...Array(3)].map((_, i) => <Sk key={i} className="h-20 w-full rounded-2xl" />)}</div>
      ) : holdings.length === 0 ? (
        <div className="py-20 text-center space-y-4 border border-white/[0.05] rounded-3xl bg-white/[0.01]">
          <Briefcase size={36} className="text-gray-700 mx-auto" />
          <p className="text-gray-500 text-sm">No positions yet. Add your first holding to start tracking.</p>
        </div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Invested",  val: `$${summary.totalInvested.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, cls: "text-white" },
                { label: "Current Value",   val: `$${summary.totalCurrent.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,  cls: "text-white" },
                { label: "Total P&L",       val: `${summary.totalPnl >= 0 ? "+" : ""}$${Math.abs(summary.totalPnl).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, cls: summary.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400" },
                { label: "Return",          val: `${summary.pnlPct >= 0 ? "+" : ""}${summary.pnlPct.toFixed(2)}%`, cls: summary.pnlPct >= 0 ? "text-emerald-400" : "text-rose-400" },
              ].map((c, i) => (
                <motion.div key={c.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="bg-white/[0.02] border border-white/[0.04] rounded-3xl p-6 backdrop-blur-xl">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-2">{c.label}</p>
                  <p className={`text-2xl font-black ${c.cls}`}>{c.val}</p>
                </motion.div>
              ))}
            </div>
          )}

          <div className="bg-[#0B0F14]/50 border border-white/[0.05] rounded-3xl overflow-hidden backdrop-blur-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.05] bg-white/[0.01]">
                    {["Asset", "Qty", "Avg Cost", "Current Price", "Total Invested", "P&L", "Return", ""].map((h, i) => (
                      <th key={i} className="px-6 py-5 text-left text-[10px] text-gray-500 uppercase tracking-widest font-black whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h, i) => {
                    const cS = getCurrencySymbol(h.symbol);
                    const cur = h.current_price || h.price;
                    const invested = h.price * h.quantity;
                    const currentVal = cur * h.quantity;
                    const pnl = currentVal - invested;
                    const pnlPct = (pnl / invested) * 100;
                    return (
                      <motion.tr key={h.id || i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                        className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors group">
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-3">
                             <StockLogo symbol={h.symbol} size={8} />
                             <div>
                               <button onClick={() => onSelectSymbol(h.symbol)} className="font-black text-white hover:text-blue-400 transition-colors">{h.symbol}</button>
                               {h.companyName && h.companyName !== h.symbol && <p className="text-[10px] text-gray-600 font-medium">{h.companyName}</p>}
                             </div>
                           </div>
                        </td>
                        <td className="px-6 py-4 text-gray-400 font-bold">{h.quantity}</td>
                        <td className="px-6 py-4 text-gray-400 font-bold">{cS}{h.price.toFixed(2)}</td>
                        <td className="px-6 py-4 text-white font-black">{cS}{cur.toFixed(2)}</td>
                        <td className="px-6 py-4 text-gray-500 font-bold">{cS}{invested.toFixed(2)}</td>
                        <td className={`px-6 py-4 font-black ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {pnl >= 0 ? "+" : "-"}{cS}{Math.abs(pnl).toFixed(2)}
                        </td>
                        <td className={`px-6 py-4 font-black ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          <span className="flex items-center gap-1.5 bg-white/[0.02] w-max px-2 py-1 rounded-lg">
                            {pnl >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => h.id && remove(h.id, h.symbol)}
                            className="opacity-0 group-hover:opacity-100 p-2 rounded-xl text-gray-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERTS VIEW
// ─────────────────────────────────────────────────────────────────────────────

function AlertsView({ user, alertsStore, onSelectSymbol }: {
  user: FirebaseUser | null;
  alertsStore: ReturnType<typeof useFirestoreAlerts>;
  onSelectSymbol: (s: string) => void;
}) {
  const { alerts, loading, add, remove } = alertsStore;
  const [showAdd, setShowAdd]   = useState(false);
  const [sym, setSym]           = useState("");
  const [price, setPrice]       = useState("");
  const [cond, setCond]         = useState<"above" | "below">("above");
  const [note, setNote]         = useState("");
  const [adding, setAdding]     = useState(false);
  const [filter, setFilter]     = useState<"all" | "active" | "triggered">("all");

  const handleAdd = async () => {
    if (!sym.trim() || !price || isNaN(+price) || +price <= 0) { toast.error("Enter a valid symbol and price"); return; }
    setAdding(true);
    try {
      await add({ symbol: sym.trim().toUpperCase(), target_price: +price, condition: cond, note });
      setShowAdd(false); setSym(""); setPrice(""); setNote("");
    } catch (e: any) { toast.error(e.message || "Failed"); }
    setAdding(false);
  };

  const shown = filter === "active"    ? alerts.filter(a => !a.triggered)
              : filter === "triggered" ? alerts.filter(a => a.triggered)
              : alerts;

  if (!user) return (
    <div className="py-32 text-center space-y-4">
      <div className="w-20 h-20 rounded-full bg-white/[0.02] border border-white/[0.05] flex items-center justify-center mx-auto">
        <Bell size={32} className="text-gray-600" />
      </div>
      <h2 className="text-xl font-black text-white">Alerts Sync Required</h2>
      <p className="text-gray-500 text-sm">Sign in to create and manage price alerts.</p>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-black tracking-tighter text-white mb-2">Price Alerts</h2>
           <p className="text-sm text-gray-500 font-medium">{alerts.length} configured triggers</p>
        </div>
        <button onClick={() => setShowAdd(p => !p)}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-[#0B0F14] hover:bg-gray-200 font-black text-sm transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)]">
          <Plus size={16} /> New Alert
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-[#0B0F14]/50 border border-white/[0.08] rounded-3xl p-8 space-y-6 backdrop-blur-2xl mb-8">
              <p className="text-xs font-black text-white uppercase tracking-widest">Configure Alert</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                  <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">Symbol</label>
                  <input value={sym} onChange={e => setSym(e.target.value.toUpperCase())} placeholder="AAPL"
                    className="w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-4 py-3.5 text-white text-sm outline-none focus:border-blue-500/50 placeholder-gray-700 font-mono font-bold" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">Condition</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["above", "below"] as const).map(c => (
                      <button key={c} onClick={() => setCond(c)}
                        className={`py-3.5 rounded-2xl text-xs font-black transition-all ${cond === c ? (c === "above" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" : "bg-rose-500/15 text-rose-400 border border-rose-500/25") : "bg-white/[0.02] text-gray-500 border border-white/[0.05] hover:bg-white/[0.04]"}`}>
                        {c === "above" ? "↑ Above" : "↓ Below"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">Target Price</label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="200.00"
                    className="w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-4 py-3.5 text-white text-sm outline-none focus:border-blue-500/50 placeholder-gray-700 font-bold" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 font-black uppercase tracking-widest block mb-2">Note (optional)</label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Break above resistance"
                  className="w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl px-4 py-3.5 text-white text-sm outline-none focus:border-blue-500/50 placeholder-gray-700 font-bold" />
              </div>
              <div className="flex gap-3">
                <button onClick={handleAdd} disabled={adding}
                  className="px-8 py-3.5 rounded-2xl bg-white text-[#0B0F14] hover:bg-gray-200 disabled:opacity-50 font-black text-sm transition-all">
                  {adding ? "Creating…" : "Create Alert"}
                </button>
                <button onClick={() => setShowAdd(false)} className="px-8 py-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.05] font-black text-sm text-gray-400 hover:text-white transition-all">
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-2 bg-white/[0.02] border border-white/[0.04] p-1 rounded-2xl w-max backdrop-blur-md">
        {(["all", "active", "triggered"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${filter === f ? "bg-white text-[#0B0F14] shadow-md" : "text-gray-500 hover:text-white"}`}>
            {f} {f === "all" ? `(${alerts.length})` : f === "active" ? `(${alerts.filter(a => !a.triggered).length})` : `(${alerts.filter(a => a.triggered).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">{[...Array(3)].map((_, i) => <Sk key={i} className="h-20 w-full rounded-2xl" />)}</div>
      ) : shown.length === 0 ? (
        <div className="py-20 text-center space-y-4 border border-white/[0.05] rounded-3xl bg-white/[0.01]">
          <BellOff size={36} className="text-gray-700 mx-auto" />
          <p className="text-gray-500 text-sm">{filter === "all" ? "No alerts configured." : `No ${filter} alerts found.`}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <AnimatePresence>
            {shown.map((alert, i) => {
              const cS = getCurrencySymbol(alert.symbol);
              return (
                <motion.div key={alert.id || i}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.05 }}
                  className={`group flex items-center gap-5 p-6 rounded-3xl border transition-all backdrop-blur-xl ${alert.triggered ? "bg-emerald-500/[0.05] border-emerald-500/15" : "bg-[#0B0F14]/50 border-white/[0.06] hover:border-white/10"}`}>
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${alert.triggered ? "bg-emerald-500/15" : alert.condition === "above" ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                    {alert.triggered ? <CheckCircle2 size={20} className="text-emerald-400" /> : alert.condition === "above" ? <TrendingUp size={20} className="text-emerald-400" /> : <TrendingDown size={20} className="text-rose-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <button onClick={() => onSelectSymbol(alert.symbol)} className="font-black text-lg text-white hover:text-blue-400 transition-colors">{alert.symbol}</button>
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${alert.condition === "above" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}>
                        {alert.condition} {cS}{alert.target_price.toFixed(2)}
                      </span>
                      {alert.triggered && <Tag color="green">✓ Triggered</Tag>}
                    </div>
                    {alert.note && <p className="text-sm text-gray-400 font-medium">{alert.note}</p>}
                    <p className="text-[10px] text-gray-600 mt-2 font-bold uppercase tracking-widest">
                      Created {alert.created_at ? new Date(alert.created_at).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  <button onClick={() => alert.id && remove(alert.id)}
                    className="opacity-0 group-hover:opacity-100 p-3 rounded-2xl text-gray-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all">
                    <Trash2 size={16} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE VIEW
// ─────────────────────────────────────────────────────────────────────────────

function CompareView({ initialSymbols = [] }: { initialSymbols?: string[] }) {
  const [symbols, setSymbols]     = useState<string[]>(initialSymbols);
  const [input, setInput]         = useState("");
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (input.length < 1) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { const r = await fetch(`${API}/search/${encodeURIComponent(input)}`); setResults((await r.json()).slice(0, 5)); }
      catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const addSym = (s: string) => {
    const u = s.trim().toUpperCase();
    if (!u || symbols.includes(u) || symbols.length >= 4) return;
    setSymbols(p => [...p, u]);
    setInput(""); setResults([]);
  };

  const { data: compareData, isLoading } = useQuery<StockData[]>({
    queryKey: ["compare", symbols.join(",")],
    queryFn: async () => {
      if (symbols.length < 2) return [];
      const results = await Promise.allSettled(
        symbols.map(sym =>
          fetch(`${API}/stock/${encodeURIComponent(sym)}`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP error for ${sym}`)))
        )
      );
      return results
        .map((r, i) => r.status === "fulfilled" ? { ...r.value, symbol: symbols[i] } : null)
        .filter(Boolean) as StockData[];
    },
    enabled: symbols.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  const stocks: StockData[] = compareData || [];

  const allDates = useMemo(() => {
    return Array.from(new Set(stocks.flatMap(s => (s.prices || []).map(p => p.date)))).sort().slice(-90);
  }, [stocks]);

  const chartData = {
    labels: allDates.map(d => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })),
    datasets: stocks.map((s, i) => {
      const base = s.prices?.[0]?.close || 1;
      const map  = Object.fromEntries((s.prices || []).map(p => [p.date, ((p.close - base) / base) * 100]));
      return {
        label: s.symbol,
        data: allDates.map(d => map[d] ?? null),
        borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
        backgroundColor: "transparent",
        borderWidth: 3, tension: 0.3, pointRadius: 0, pointHoverRadius: 6, spanGaps: true,
      };
    }),
  };

  const METRICS = [
    { key: "final_score",     label: "AI Score",   fmt: (v: number) => `${(v * 100).toFixed(0)}%`,                       hi: (v: number) => v >= 0.68 ? "text-emerald-400" : v < 0.38 ? "text-rose-400" : "text-amber-400" },
    { key: "sentiment_score", label: "Sentiment",  fmt: (v: number) => `${(v * 100).toFixed(0)}%`,                       hi: (v: number) => v > 0.6 ? "text-emerald-400" : v < 0.4 ? "text-rose-400" : "text-amber-400" },
    { key: "technical_score", label: "Technical",  fmt: (v: number) => `${(v * 100).toFixed(0)}%`,                       hi: (v: number) => v > 0.6 ? "text-emerald-400" : v < 0.4 ? "text-rose-400" : "text-amber-400" },
  ];

  const FUND_METRICS = [
    { key: "pe_ratio",       label: "P/E",       fmt: (v: number) => v ? `${v.toFixed(1)}x` : "—",             hi: (v: number) => v < 20 ? "text-emerald-400" : v < 35 ? "text-amber-400" : "text-rose-400" },
    { key: "beta",           label: "Beta",      fmt: (v: number) => v?.toFixed(2) ?? "—",                     hi: (v: number) => v < 0.8 ? "text-emerald-400" : v < 1.5 ? "text-amber-400" : "text-rose-400" },
    { key: "profit_margin",  label: "Net Margin",fmt: (v: number) => v ? `${v.toFixed(1)}%` : "—",             hi: (v: number) => v > 15 ? "text-emerald-400" : v > 0 ? "text-amber-400" : "text-rose-400" },
    { key: "roe",            label: "ROE",       fmt: (v: number) => v ? `${v.toFixed(1)}%` : "—",             hi: (v: number) => v > 15 ? "text-emerald-400" : "text-amber-400" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
           <h2 className="text-3xl font-black tracking-tighter text-white mb-2">Compare Assets</h2>
           <p className="text-sm text-gray-500 font-medium">Evaluate relative performance and AI metrics.</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap bg-[#0B0F14]/50 border border-white/[0.08] rounded-2xl p-3 backdrop-blur-xl">
          {symbols.map((s, i) => (
            <div key={s} className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black border"
              style={{ borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length] + "50", backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length] + "15", color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>
              <StockLogo symbol={s} size={6} />
              {s}
              <button onClick={() => setSymbols(p => p.filter(x => x !== s))} className="opacity-70 hover:opacity-100 ml-1"><X size={14} /></button>
            </div>
          ))}
          {symbols.length < 4 && (
            <div className="relative">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                <Search size={14} className="text-gray-500" />
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && input.trim()) addSym(input); }}
                  placeholder="Add symbol…" className="bg-transparent text-sm outline-none text-white placeholder-gray-600 w-24 font-bold" />
                {searching && <RefreshCw size={12} className="animate-spin text-blue-400" />}
              </div>
              {results.length > 0 && (
                <div className="absolute top-full mt-2 left-0 w-64 bg-[#0B0F14] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl z-50">
                  {results.map(s => (
                    <button key={s.symbol} onClick={() => addSym(s.symbol)}
                      className="w-full text-left px-4 py-3 hover:bg-white/[0.05] text-sm flex items-center gap-3 transition-colors">
                      <Plus size={14} className="text-blue-400 shrink-0" />
                      <div>
                        <span className="font-black text-white block">{s.symbol}</span>
                        <span className="text-[10px] text-gray-500 truncate block">{s.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {symbols.length < 2 ? (
        <div className="py-32 text-center border border-white/[0.05] rounded-3xl bg-white/[0.01]">
          <p className="text-gray-500 text-sm">Add at least 2 symbols to begin comparison.</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-4">{[...Array(2)].map((_, i) => <Sk key={i} className="h-40 w-full rounded-3xl" />)}</div>
      ) : (
        <>
          {stocks.length >= 2 && (
            <div className="bg-[#0B0F14]/50 border border-white/[0.05] rounded-3xl p-8 backdrop-blur-2xl">
              <p className="text-xs text-white uppercase font-black tracking-widest mb-1">Relative Performance (90 days)</p>
              <p className="text-xs text-gray-500 font-medium mb-8">Normalized to % return from period start</p>
              <div style={{ height: 350 }}>
                <Line data={chartData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: true, labels: { color: "#9ca3af", font: { size: 12, weight: "bold", family: "inherit" }, boxWidth: 16, padding: 24 } },
                    tooltip: { backgroundColor: "rgba(11, 15, 20, 0.9)", borderColor: "rgba(255,255,255,0.1)", borderWidth: 1, padding: 12, titleColor: "#9ca3af", bodyColor: "#fff", titleFont: { size: 12, family: "inherit" }, bodyFont: { size: 14, weight: "bold", family: "inherit" }, callbacks: { label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2) ?? "—"}%` } },
                  },
                  scales: {
                    x: { grid: { display: false }, ticks: { color: "#6b7280", maxTicksLimit: 6, font: { size: 11, weight: "bold" } } },
                    y: { grid: { color: "rgba(255,255,255,0.03)" }, ticks: { color: "#6b7280", font: { size: 11, weight: "bold" }, callback: (v: any) => `${Number(v).toFixed(0)}%` } },
                  },
                  interaction: { mode: "index", intersect: false },
                }} />
              </div>
            </div>
          )}

          <div className="bg-[#0B0F14]/50 border border-white/[0.05] rounded-3xl overflow-hidden backdrop-blur-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.05] bg-white/[0.01]">
                    <th className="text-left px-8 py-6 text-[10px] text-gray-500 uppercase tracking-widest font-black w-40">Metric</th>
                    {stocks.map((s, i) => (
                      <th key={s.symbol} className="px-8 py-6 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <StockLogo symbol={s.symbol} size={12} />
                          <span className="text-xl font-black" style={{ color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>{s.symbol}</span>
                          {s.fundamentals?.sector && <span className="text-[10px] bg-white/[0.02] text-gray-500 border border-white/[0.05] px-3 py-1 rounded-full">{s.fundamentals.sector}</span>}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(m => (
                    <tr key={m.key} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                      <td className="px-8 py-5 text-xs text-gray-400 font-bold uppercase tracking-wider">{m.label}</td>
                      {stocks.map(s => {
                        const raw = (s as any)[m.key] as number | undefined;
                        return <td key={s.symbol} className={`px-8 py-5 text-center text-lg font-black ${raw != null ? m.hi(raw) : "text-gray-700"}`}>{raw != null ? m.fmt(raw) : "N/A"}</td>;
                      })}
                    </tr>
                  ))}
                  {FUND_METRICS.map(m => (
                    <tr key={m.key} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                      <td className="px-8 py-5 text-xs text-gray-400 font-bold uppercase tracking-wider">{m.label}</td>
                      {stocks.map(s => {
                        const raw = (s.fundamentals as any)?.[m.key] as number | undefined;
                        return <td key={s.symbol} className={`px-8 py-5 text-center text-lg font-black ${raw != null ? m.hi(raw) : "text-gray-700"}`}>{raw != null ? m.fmt(raw) : "N/A"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH BAR
// ─────────────────────────────────────────────────────────────────────────────

function SearchBar({ onSelect }: { onSelect: (s: string) => void }) {
  const [input, setInput]     = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const [idx, setIdx]         = useState(-1);
  const inputRef              = useRef<HTMLInputElement>(null);
  const debouncedInput        = useDebounce(input, 320);

  useEffect(() => {
    if (debouncedInput.length < 1) { setResults([]); return; }
    setLoading(true);
    fetch(`${API}/search/${encodeURIComponent(debouncedInput)}`)
      .then(r => r.json()).then(d => { setResults(Array.isArray(d) ? d : []); setOpen(true); })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debouncedInput]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
      if (e.key === "Escape") { setOpen(false); setInput(""); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const handleSelect = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setInput(""); setOpen(false); setIdx(-1);
    onSelect(s);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { if (results[idx]) handleSelect(results[idx].symbol); else if (input.trim()) handleSelect(input.trim()); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setIdx(p => (p + 1) % Math.max(results.length, 1)); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(p => p <= 0 ? results.length - 1 : p - 1); }
  };

  return (
    <>
      {open && input && (
        <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" onClick={() => { setOpen(false); setInput(""); }} />
      )}
      <div className="relative z-50 w-full max-w-2xl mx-auto">
        <div className={`flex items-center gap-3 p-2 rounded-2xl bg-[#0B0F14]/80 backdrop-blur-xl border transition-all ${open && input ? "border-blue-500/50 shadow-[0_0_40px_rgba(59,130,246,0.15)]" : "border-white/[0.08]"}`}>
          <div className="ml-4">{loading ? <RefreshCw size={18} className="text-blue-400 animate-spin" /> : <Search size={18} className={open ? "text-blue-400" : "text-gray-500"} />}</div>
          <input ref={inputRef} value={input} onChange={e => { setInput(e.target.value); setIdx(-1); if (e.target.value) setOpen(true); }}
            onKeyDown={handleKey} onFocus={() => setOpen(true)}
            placeholder="Search any symbol, company, or index... (⌘K)"
            className="flex-1 bg-transparent px-2 py-3 outline-none text-white text-base placeholder-gray-600 font-bold" autoComplete="off" spellCheck={false} />
          {input ? (
            <button onClick={() => { setInput(""); inputRef.current?.focus(); }} className="mr-3 text-gray-500 hover:text-white transition-colors"><X size={16} /></button>
          ) : (
            <div className="hidden sm:flex items-center gap-1 px-3 py-1.5 mr-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-gray-500 text-xs font-black">⌘ K</div>
          )}
        </div>

        <AnimatePresence>
          {open && input && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute w-full mt-4 bg-[#0B0F14]/90 backdrop-blur-2xl border border-white/[0.1] rounded-3xl overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.8)] max-h-96 overflow-y-auto z-50">
              {loading && (
                <div className="p-10 flex flex-col items-center gap-4 text-gray-500">
                  <RefreshCw size={24} className="animate-spin text-blue-500" />
                  <span className="text-sm font-bold">Scanning Global Markets…</span>
                </div>
              )}
              {!loading && results.length === 0 && (
                <div className="p-10 text-center text-gray-500 text-sm font-bold">No exact matches — press Enter to analyze &ldquo;{input}&rdquo; directly</div>
              )}
              {results.map((item, i) => (
                <div key={`${item.symbol}-${i}`} onClick={() => handleSelect(item.symbol)} onMouseEnter={() => setIdx(i)}
                  className={`px-6 py-4 cursor-pointer flex items-center justify-between border-l-4 transition-all ${i === idx ? "bg-white/[0.05] border-blue-500" : "border-transparent hover:bg-white/[0.02]"}`}>
                  <div className="flex items-center gap-4">
                    <StockLogo symbol={item.symbol} size={10} />
                    <div>
                      <p className="font-black text-lg text-white">{item.symbol}</p>
                      <p className="text-sm text-gray-500 font-medium truncate max-w-[250px]">{item.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-600">{item.exchange}</span>
                    <Tag color="gray">{item.type || "EQUITY"}</Tag>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ watchlist, onSelect, onRemoveFromWatchlist }: {
  watchlist: string[]; onSelect: (s: string) => void; onRemoveFromWatchlist: (s: string) => void;
}) {
  return (
    <div className="max-w-4xl mx-auto space-y-16 py-20 flex flex-col items-center">
      <div className="text-center space-y-6">
        <div className="w-24 h-24 rounded-3xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto shadow-[0_0_40px_rgba(59,130,246,0.15)]">
          <BarChart2 size={40} className="text-blue-400" />
        </div>
        <h1 className="text-5xl font-black tracking-tighter text-white">Market Intelligence</h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">Search any stock, crypto, or index to generate an instant, AI-powered analysis report featuring sentiment scoring and technical signals.</p>
      </div>

      {watchlist.length > 0 && (
        <section className="w-full">
          <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-4 flex items-center justify-center gap-2">
            <Star size={14} className="text-yellow-400 fill-yellow-400" /> Your Tracked Assets
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {watchlist.map(sym => (
              <motion.div key={sym} whileHover={{ y: -4 }} onClick={() => onSelect(sym)}
                className="p-5 rounded-3xl bg-[#0B0F14]/50 backdrop-blur-xl border border-white/[0.05] hover:border-blue-500/30 cursor-pointer flex justify-between items-center group transition-all shadow-lg">
                <div className="flex items-center gap-4">
                  <StockLogo symbol={sym} size={10} />
                  <span className="font-black text-lg text-white">{sym}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ArrowRight size={16} className="text-gray-600 group-hover:text-blue-400 transition-colors" />
                  <button onClick={e => { e.stopPropagation(); onRemoveFromWatchlist(sym); }}
                    className="p-2 text-gray-600 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 bg-white/[0.02] rounded-xl hover:bg-rose-500/10">
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <section className="text-center w-full">
        <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-4">Trending Now</p>
        <div className="flex flex-wrap justify-center gap-3">
          {POPULAR.map(sym => (
            <button key={sym} onClick={() => onSelect(sym)}
              className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-blue-500/30 hover:bg-blue-500/[0.05] text-sm font-black text-gray-400 hover:text-white transition-all">
              <StockLogo symbol={sym} size={6} />
              {sym}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REBUILT: MAIN DASHBOARD LAYOUT (Sidebar + Main Content)
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0B0F14] flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 rounded-full border-4 border-t-blue-500 border-white/5 animate-spin" />
          <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Initializing Environment…</p>
        </div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams                                  = useSearchParams();
  const [view, setView]                               = useState<View>("dashboard");
  const [activeSymbol, setActiveSymbol]               = useState<string | null>(searchParams.get("symbol") || null);
  const [compareSyms, setCompareSyms]                 = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen]                 = useState(true);
  
  const { user, loading: authLoading, signIn, signOut } = useFirebaseAuth();
  const { list: watchlist, toggle: toggleWatchlist }    = useWatchlist(user?.uid);
  const portfolio  = useFirestorePortfolio(user?.uid);
  const alertsStore = useFirestoreAlerts(user?.uid);

  useEffect(() => {
    try { const last = localStorage.getItem("lastStock"); if (!searchParams.get("symbol") && last) setActiveSymbol(last); } catch {}
  }, [searchParams]);

  useEffect(() => {
    if (activeSymbol) { try { localStorage.setItem("lastStock", activeSymbol); } catch {} }
  }, [activeSymbol]);

  const handleSelect = useCallback((sym: string) => {
    setActiveSymbol(sym.trim().toUpperCase());
    setView("dashboard");
  }, []);

  const navItems: { id: View; icon: React.ReactNode; label: string }[] = [
    { id: "dashboard", icon: <BarChart2 size={16} />, label: "Intelligence" },
    { id: "portfolio", icon: <Briefcase size={16} />, label: "Portfolio" },
    { id: "alerts",    icon: <Bell size={16} />,      label: "Alerts" },
    { id: "compare",   icon: <GitCompare size={16} />,label: "Compare" },
  ];

  return (
    <main className="flex h-screen bg-[#0B0F14] text-white overflow-hidden font-sans selection:bg-blue-500/30">
      <style>{`
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        .scrollbar-hide::-webkit-scrollbar{display:none}
        .scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}
      `}</style>

      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: "#111", color: "#fff", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", fontSize: "14px", fontWeight: 700, padding: "16px" },
          success: { iconTheme: { primary: "#34d399", secondary: "#111" } },
          error:   { iconTheme: { primary: "#fb7185", secondary: "#111" } },
        }}
      />

      {/* ── LEFT SIDEBAR ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside 
            initial={{ width: 0, opacity: 0, x: -20 }}
            animate={{ width: 300, opacity: 1, x: 0 }}
            exit={{ width: 0, opacity: 0, x: -20 }}
            className="flex-shrink-0 border-r border-white/[0.05] bg-[#0B0F14]/80 backdrop-blur-3xl flex flex-col z-20 shadow-[20px_0_40px_rgba(0,0,0,0.5)]"
          >
            <div className="p-8 border-b border-white/[0.05]">
              <h2 className="text-2xl font-black tracking-tighter flex items-center gap-3 text-white">
                <Command size={24} className="text-blue-500" /> FinIntel
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-8">
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-4 px-2 flex items-center gap-2">
                   <Star size={12} className="text-yellow-400 fill-yellow-400" /> Watchlist
                </p>
                {watchlist.length === 0 ? (
                  <div className="px-2 py-4 bg-white/[0.02] rounded-2xl border border-white/[0.03] text-center">
                    <p className="text-xs text-gray-600 font-bold">No tracked assets.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {watchlist.map(sym => (
                      <button 
                        key={sym} 
                        onClick={() => handleSelect(sym)}
                        className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${
                          activeSymbol === sym ? "bg-white/[0.06] shadow-sm border border-white/[0.05]" : "hover:bg-white/[0.02] border border-transparent"
                        }`}
                      >
                        <StockLogo symbol={sym} size={8} />
                        <span className="text-sm font-black text-white">{sym}</span>
                        {activeSymbol === sym && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-6 border-t border-white/[0.05] bg-white/[0.01]">
              {!user ? (
                 <button onClick={signIn} className="w-full py-4 rounded-2xl bg-white text-[#0B0F14] hover:bg-gray-200 text-sm font-black transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                   Sign in to Sync
                 </button>
              ) : (
                 <div className="flex items-center gap-4 px-2">
                   {user.photoURL ? <img src={user.photoURL} className="w-10 h-10 rounded-full border-2 border-white/[0.1]" /> : <div className="w-10 h-10 rounded-full bg-blue-500/20 border-2 border-blue-500/50 flex items-center justify-center font-black text-blue-400">{user.displayName?.charAt(0)}</div>}
                   <div className="flex-1 min-w-0 text-left">
                     <p className="text-sm font-black text-white truncate">{user.displayName}</p>
                     <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest truncate">Pro Member</p>
                   </div>
                   <button onClick={signOut} className="text-gray-500 hover:text-rose-400 bg-white/[0.03] p-2 rounded-xl hover:bg-rose-500/10 transition-colors"><LogOut size={16} /></button>
                 </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── MAIN CONTENT AREA ── */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-blue-500/10 blur-[200px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-purple-500/5 blur-[150px] rounded-full pointer-events-none" />
        
        {/* TOP NAVBAR */}
        <header className="h-24 border-b border-white/[0.05] bg-[#0B0F14]/30 backdrop-blur-2xl flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-8">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="w-10 h-10 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/[0.05] transition-all">
              <Command size={18} />
            </button>
            <div className="hidden md:flex items-center gap-2 p-1.5 bg-white/[0.02] border border-white/[0.04] rounded-2xl backdrop-blur-md">
               {navItems.map(n => (
                 <button 
                   key={n.id} 
                   onClick={() => setView(n.id)}
                   className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black tracking-wide transition-all ${
                     view === n.id ? "bg-white text-[#0B0F14] shadow-md" : "text-gray-400 hover:text-white hover:bg-white/[0.05]"
                   }`}
                 >
                   {n.icon} {n.label}
                 </button>
               ))}
            </div>
          </div>
          
          <div className="w-full max-w-xl mx-4">
             <SearchBar onSelect={handleSelect} />
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {activeSymbol && view === "dashboard" && (
               <button onClick={() => toggleWatchlist(activeSymbol)}
                 className={`hidden sm:flex items-center gap-2 px-5 py-3 rounded-2xl text-xs font-black transition-all border ${watchlist.includes(activeSymbol) ? "bg-yellow-400/10 text-yellow-400 border-yellow-400/20" : "bg-white/[0.02] text-gray-400 border-white/[0.05] hover:text-white hover:bg-white/[0.05]"}`}>
                 <Star size={16} className={watchlist.includes(activeSymbol) ? "fill-yellow-400" : ""} />
                 {watchlist.includes(activeSymbol) ? "Tracked" : "Track"}
               </button>
            )}
          </div>
        </header>

        {/* SCROLLABLE VIEW PORT */}
        <div className="flex-1 overflow-y-auto scrollbar-hide p-6 md:p-12 z-0">
          <AnimatePresence mode="wait">
            {view === "dashboard" && (
              <motion.div key="dash" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {!activeSymbol ? (
                  <EmptyState watchlist={watchlist} onSelect={handleSelect} onRemoveFromWatchlist={toggleWatchlist} />
                ) : (
                  <StockAnalysis symbol={activeSymbol} user={user} onAddToPortfolio={portfolio.add} />
                )}
              </motion.div>
            )}
            {view === "portfolio" && (
              <motion.div key="port" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <PortfolioView user={user} portfolio={portfolio} onSelectSymbol={handleSelect} />
              </motion.div>
            )}
            {view === "alerts" && (
              <motion.div key="alerts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <AlertsView user={user} alertsStore={alertsStore} onSelectSymbol={handleSelect} />
              </motion.div>
            )}
            {view === "compare" && (
              <motion.div key="compare" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <CompareView initialSymbols={compareSyms} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}