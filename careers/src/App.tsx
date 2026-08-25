/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, AnimatePresence } from "motion/react";
import {
  Menu,
  X,
  ArrowRight,
  School,
  TrendingUp,
  Users,
  BookOpen,
  Instagram,
  MapPin,
  Phone,
  ArrowUpRight,
  Send,
  CheckCircle2
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "./firebase";
import { collection, addDoc, serverTimestamp, getDocs, query, orderBy } from "firebase/firestore";

const navLinks = [
  { name: "Studio", href: "#studio" },
  { name: "Careers", href: "#careers" },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const [applications, setApplications] = useState<any[]>([]);
  const [showAdmin, setShowAdmin] = useState(false);

  const isAdmin = user?.email === "home@archivepilates.com" || user?.email === "home@archivepilate.com";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchApplications = async () => {
      if (!isAdmin) return;
      try {
        const q = query(collection(db, "applications"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        const apps = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setApplications(apps);
      } catch (error) {
        console.error("Failed to fetch applications", error);
      }
    };

    if (isAdmin && showAdmin) {
      fetchApplications();
    }
  }, [isAdmin, showAdmin]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleApplySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    try {
      // 1. Save to Firestore
      await addDoc(collection(db, "applications"), {
        ...data,
        createdAt: serverTimestamp(),
        userId: user?.uid || null,
      });

      // 2. 구글 시트 연동 (Google Apps Script Webhook)
      // 아래 URL을 구글 앱스 스크립트에서 배포한 웹앱 URL로 교체해주세요.
      const GOOGLE_SCRIPT_URL = "여기에_구글_앱스스크립트_웹앱_URL을_넣어주세요";

      if (GOOGLE_SCRIPT_URL.startsWith("http")) {
        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          mode: "no-cors", // 구글 스크립트 CORS 에러 방지
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }

      setIsSubmitted(true);
      setTimeout(() => {
        setIsApplyModalOpen(false);
        setIsSubmitted(false);
      }, 3000);
    } catch (error) {
      console.error("Submission failed:", error);
      alert("지원서 제출 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface selection:bg-primary-container/30">
      {/* Navigation */}
      <nav
        className={`fixed top-0 w-full z-50 transition-all duration-300 px-6 h-20 flex items-center justify-between ${
          scrolled ? "bg-surface/80 backdrop-blur-md border-b border-on-surface/5" : "bg-transparent"
        }`}
      >
        <div className="flex-1 flex items-center">
          <button
            onClick={() => setIsMenuOpen(true)}
            className="text-on-surface hover:opacity-70 transition-opacity"
          >
            <Menu size={24} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 flex justify-center items-center gap-3">
          <img
            src="/logo.png"
            alt="Archive Pilates Logo"
            className="h-8 w-8 object-contain"
            onError={(e) => (e.currentTarget.style.display = 'none')}
            referrerPolicy="no-referrer"
          />
          <h1 className="font-headline text-2xl font-semibold tracking-widest text-primary-container italic whitespace-nowrap">
            ARCHIVE PILATES
          </h1>
        </div>

        <div className="flex-1 hidden md:flex items-center justify-end gap-8">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="text-[11px] uppercase tracking-[0.2em] font-medium text-on-surface/60 hover:text-primary transition-colors"
            >
              {link.name}
            </a>
          ))}
          {user ? (
            <div className="flex items-center gap-4">
              {isAdmin && (
                <button
                  onClick={() => setShowAdmin(true)}
                  className="text-[10px] uppercase tracking-widest font-bold text-primary hover:opacity-70 mr-2"
                >
                  Admin
                </button>
              )}
              <span className="text-[10px] text-on-surface/40">{user.displayName}</span>
              <button
                onClick={handleLogout}
                className="text-[10px] uppercase tracking-widest font-bold text-primary hover:opacity-70"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="text-[10px] uppercase tracking-widest font-bold text-on-surface/60 hover:text-primary"
            >
              Login
            </button>
          )}
        </div>

        <div className="md:hidden flex-1" /> {/* Spacer for centering mobile title */}
      </nav>

      {/* Mobile Menu Overlay */}
      <motion.div
        initial={false}
        animate={{ x: isMenuOpen ? 0 : "-100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="fixed inset-0 z-[60] bg-surface flex flex-col p-8"
      >
        <div className="flex justify-between items-center mb-16">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Archive Pilates Logo"
              className="h-8 w-8 object-contain"
              onError={(e) => (e.currentTarget.style.display = 'none')}
              referrerPolicy="no-referrer"
            />
            <h1 className="font-headline text-2xl font-semibold tracking-widest text-primary-container italic">
              ARCHIVE
            </h1>
          </div>
          <button onClick={() => setIsMenuOpen(false)} className="text-on-surface">
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-8">
          {navLinks.map((link, i) => (
            <motion.a
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: isMenuOpen ? 1 : 0, y: isMenuOpen ? 0 : 20 }}
              transition={{ delay: i * 0.1 }}
              key={link.name}
              href={link.href}
              onClick={() => setIsMenuOpen(false)}
              className="font-headline text-4xl italic text-on-surface hover:text-primary transition-colors"
            >
              {link.name}
            </motion.a>
          ))}

          {/* Mobile Login/Logout */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: isMenuOpen ? 1 : 0, y: isMenuOpen ? 0 : 20 }}
            transition={{ delay: navLinks.length * 0.1 }}
            className="pt-8 border-t border-on-surface/10"
          >
            {user ? (
              <div className="space-y-4">
                <p className="text-sm font-medium text-on-surface/60">{user.displayName}님 환영합니다</p>
                <div className="flex flex-col gap-4">
                  {isAdmin && (
                    <button
                      onClick={() => {
                        setShowAdmin(true);
                        setIsMenuOpen(false);
                      }}
                      className="text-left font-headline text-2xl italic text-primary"
                    >
                      Admin Dashboard
                    </button>
                  )}
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsMenuOpen(false);
                    }}
                    className="text-left font-headline text-2xl italic text-on-surface/40"
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  handleLogin();
                  setIsMenuOpen(false);
                }}
                className="font-headline text-4xl italic text-primary"
              >
                Login
              </button>
            )}
          </motion.div>
        </div>

        <div className="mt-auto pt-8 border-t border-on-surface/10 flex justify-between items-end">
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-on-surface/40">Follow us</p>
            <div className="flex gap-4">
              <a
                href="https://www.instagram.com/archivepilates_official/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-on-surface/60 hover:text-primary transition-colors"
              >
                <Instagram size={20} strokeWidth={1.5} />
              </a>
            </div>
          </div>
          <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">© 2024 Archive</p>
        </div>
      </motion.div>

      {/* Hero Section */}
      <header className="relative h-screen flex items-center justify-center overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.5 }}
          className="absolute inset-0"
        >
          <img
            src="/philosophy.png"
            alt="Pilates Studio"
            className="w-full h-full object-cover grayscale opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-surface/20 via-transparent to-surface" />
        </motion.div>

        <div className="relative z-10 text-center px-6">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-[11px] uppercase tracking-[0.4em] text-primary font-bold mb-6"
          >
            Movement Archived, Life Refined.
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.8 }}
            className="font-headline text-6xl md:text-8xl italic text-on-surface leading-tight mb-8"
          >
            당신의 움직임을 <br className="md:hidden" /> 기록합니다
          </motion.h2>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
          >
            <a href="#studio" className="group flex items-center gap-3 mx-auto text-[11px] uppercase tracking-[0.2em] font-bold text-on-surface border-b border-on-surface/20 pb-2 hover:border-primary transition-all w-fit">
              Explore the Studio
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </a>
          </motion.div>
        </div>

        {/* Scroll Indicator */}
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4"
        >
          <div className="w-px h-12 bg-gradient-to-b from-on-surface/20 to-transparent" />
        </motion.div>
      </header>

      {/* Philosophy Section (About) */}
      <section id="studio" className="py-32 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="aspect-[4/5] overflow-hidden rounded-sm"
          >
            <img
              src="/philosophy.png"
              alt="Archive Pilates Philosophy"
              className="w-full h-full object-cover hover:scale-105 transition-all duration-1000"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = "https://images.unsplash.com/photo-1599447421416-3414500d18a5?q=80&w=2070&auto=format&fit=crop";
              }}
              referrerPolicy="no-referrer"
            />
          </motion.div>
          <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-primary-container/10 -z-10" />
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <span className="text-primary font-headline italic text-xl">01. Philosophy</span>
            <h3 className="text-4xl font-headline italic leading-tight">
              과정의 기록, <br /> 결과의 증명
            </h3>
          </div>
          <div className="text-on-surface-variant leading-relaxed font-light text-lg space-y-4">
            <p>
              안녕하세요, 아카이브 필라테스입니다. <br />
              우리는 단순히 동작을 전달하는 곳이 아닙니다. 회원의 몸이 바뀌는 과정, 그 결과값이 주는 감동을 '기록'하고 증명하는 공간입니다.
            </p>
            <p>
              아카이브는 강사를 단순히 '수업을 대신 해주는 인력'으로 보지 않습니다. 강사님 한 분 한 분이 하나의 브랜드로 성장할 때, 센터의 가치도 함께 높아진다고 믿기 때문입니다.
            </p>
            <p className="text-primary font-medium">
              우리의 철학에 공감하고, 진심으로 회원의 변화에 기뻐할 줄 아는 오후 전담 정규직 강사님을 모십니다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 pt-8 border-t border-on-surface/5">
            <div>
              <p className="font-headline text-3xl italic text-primary mb-1">100%</p>
              <p className="text-[10px] uppercase tracking-widest text-on-surface/40">Personalized Care</p>
            </div>
            <div>
              <p className="font-headline text-3xl italic text-primary mb-1">5:1</p>
              <p className="text-[10px] uppercase tracking-widest text-on-surface/40">Small Group Density</p>
            </div>
          </div>
        </div>
      </section>

      {/* Careers Section */}
      <section id="careers" className="py-32 px-6 max-w-7xl mx-auto border-t border-on-surface/5">
        <div className="flex flex-col md:flex-row justify-between items-start gap-12 mb-20">
          <div className="max-w-xl">
            <span className="text-primary font-headline italic text-xl mb-2 block">Growth & Benefits</span>
            <h3 className="text-5xl font-headline italic mb-6">성장과 혜택</h3>
            <p className="text-on-surface-variant leading-relaxed">
              Archive Pilates는 강사진의 지속적인 성장과 정체성을 최우선으로 생각합니다.
              아카이브와 함께 기록해나갈 당신의 커리어 패스를 지원합니다.
            </p>
          </div>
          <button
            onClick={() => setIsApplyModalOpen(true)}
            className="bg-on-surface text-surface px-10 py-4 text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary transition-colors"
          >
            Join our Archive
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-8 p-8 bg-on-surface/5 rounded-sm">
            <h5 className="font-headline text-3xl italic text-primary">✔ 우리가 찾는 분</h5>
            <ul className="space-y-6">
              <li className="flex gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
                <p className="text-on-surface-variant leading-relaxed">
                  "오늘 수업 좋았어요"라는 말보다 <span className="text-on-surface font-medium">"제 몸이 정말 변했어요"</span>라는 말에 더 큰 보람을 느끼시는 분
                </p>
              </li>
              <li className="flex gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
                <p className="text-on-surface-variant leading-relaxed">
                  개인의 성장이 팀의 성장으로 이어진다고 믿는 <span className="text-on-surface font-medium">긍정적인 에너지</span>를 가진 분
                </p>
              </li>
              <li className="flex gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
                <p className="text-on-surface-variant leading-relaxed">
                  장기적인 관점에서 자신만의 <span className="text-on-surface font-medium">티칭 브랜드</span>를 구축하고 싶은 분
                </p>
              </li>
            </ul>
          </div>

          <div className="space-y-8 p-8 bg-primary/5 rounded-sm">
            <h5 className="font-headline text-3xl italic text-primary">✔ 아카이브가 약속하는 것</h5>
            <ul className="space-y-6">
              <li className="flex gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <CheckCircle2 size={18} className="text-primary" />
                </div>
                <p className="text-on-surface-variant leading-relaxed">
                  수업에만 온전히 몰입할 수 있는 <span className="text-on-surface font-medium">체계적인 회원 관리 시스템</span>
                </p>
              </li>
              <li className="flex gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <CheckCircle2 size={18} className="text-primary" />
                </div>
                <p className="text-on-surface-variant leading-relaxed">
                  실력과 노력에 정직하게 비례하는 <span className="text-on-surface font-medium">합리적인 급여 및 인센티브 구조</span>
                </p>
              </li>
              <li className="flex gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <CheckCircle2 size={18} className="text-primary" />
                </div>
                <p className="text-on-surface-variant leading-relaxed">
                  강사 브랜딩을 위한 <span className="text-on-surface font-medium">전폭적인 지원과 성장 환경</span>
                </p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Application Modal */}
      <AnimatePresence>
        {isApplyModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsApplyModalOpen(false)}
              className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-surface w-full max-w-2xl p-8 md:p-12 overflow-y-auto max-h-[90vh] rounded-sm shadow-2xl"
            >
              <button
                onClick={() => setIsApplyModalOpen(false)}
                className="absolute top-6 right-6 text-on-surface/40 hover:text-on-surface transition-colors"
              >
                <X size={24} strokeWidth={1.5} />
              </button>

              {isSubmitted ? (
                <div className="py-20 text-center space-y-6">
                  <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
                    <CheckCircle2 size={40} strokeWidth={1.5} />
                  </div>
                  <h3 className="font-headline text-4xl italic">지원이 완료되었습니다</h3>
                  <p className="text-on-surface-variant">
                    소중한 지원 감사합니다. <br />
                    검토 후 home@archivepilates.com을 통해 연락드리겠습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-12">
                  <div className="space-y-4">
                    <span className="text-primary font-headline italic text-xl">Join the Team</span>
                    <h3 className="text-4xl font-headline italic">입사지원 양식</h3>
                    <p className="text-on-surface-variant text-sm">
                      아카이브 필라테스와 함께할 강사님의 정보를 입력해주세요.
                    </p>
                  </div>

                  <form onSubmit={handleApplySubmit} className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface/40">이름</label>
                        <input required name="name" type="text" defaultValue={user?.displayName || ""} className="w-full bg-transparent border-b border-on-surface/10 py-2 focus:outline-none focus:border-primary transition-colors text-sm" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface/40">연락처</label>
                        <input required name="phone" type="tel" className="w-full bg-transparent border-b border-on-surface/10 py-2 focus:outline-none focus:border-primary transition-colors text-sm" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface/40">이메일</label>
                        <input required name="email" type="email" defaultValue={user?.email || ""} className="w-full bg-transparent border-b border-on-surface/10 py-2 focus:outline-none focus:border-primary transition-colors text-sm" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface/40">경력 (년수)</label>
                        <input required name="experience" type="text" className="w-full bg-transparent border-b border-on-surface/10 py-2 focus:outline-none focus:border-primary transition-colors text-sm" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface/40">자기소개 및 지원동기</label>
                      <textarea required name="message" rows={4} className="w-full bg-transparent border-b border-on-surface/10 py-2 focus:outline-none focus:border-primary transition-colors text-sm resize-none" />
                    </div>

                    <button
                      disabled={isSubmitting}
                      className="w-full bg-on-surface text-surface py-4 text-[11px] uppercase tracking-[0.2em] font-bold hover:bg-primary transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {isSubmitting ? "보내는 중..." : "지원서 제출하기"}
                      {!isSubmitting && <Send size={14} />}
                    </button>
                  </form>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Modal */}
      <AnimatePresence>
        {showAdmin && isAdmin && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdmin(false)}
              className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-surface w-full max-w-4xl p-8 md:p-12 overflow-y-auto max-h-[90vh] rounded-sm shadow-2xl"
            >
              <button
                onClick={() => setShowAdmin(false)}
                className="absolute top-6 right-6 text-on-surface/40 hover:text-on-surface transition-colors"
              >
                <X size={24} strokeWidth={1.5} />
              </button>

              <div className="space-y-8">
                <div className="space-y-2">
                  <span className="text-primary font-headline italic text-xl">Admin Dashboard</span>
                  <h3 className="text-4xl font-headline italic">지원서 관리</h3>
                </div>

                <div className="space-y-6">
                  {applications.length === 0 ? (
                    <p className="text-on-surface/60 py-8 text-center">제출된 지원서가 없습니다.</p>
                  ) : (
                    applications.map((app) => (
                      <div key={app.id} className="border border-on-surface/10 p-6 rounded-sm space-y-4">
                        <div className="flex justify-between items-start border-b border-on-surface/5 pb-4">
                          <div>
                            <h4 className="font-bold text-lg">{app.name}</h4>
                            <p className="text-sm text-on-surface/60">{app.email}</p>
                          </div>
                          <span className="text-xs text-on-surface/40">
                            {app.createdAt?.toDate?.().toLocaleString() || 'N/A'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-on-surface/40 mb-1">연락처</p>
                            <p>{app.phone}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-on-surface/40 mb-1">경력</p>
                            <p>{app.experience}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 mb-2">자기소개 및 지원동기</p>
                          <div className="bg-on-surface/5 p-4 rounded-sm text-sm whitespace-pre-wrap">
                            {app.message}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer id="archive" className="bg-on-surface text-surface py-20 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-16">
          <div className="md:col-span-5 space-y-8 text-center md:text-left">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-4">
              <img
                src="/logo.png"
                alt="Archive Pilates Logo"
                className="h-12 w-12 object-contain"
                onError={(e) => (e.currentTarget.style.display = 'none')}
                referrerPolicy="no-referrer"
              />
              <h2 className="font-headline text-4xl italic tracking-widest text-primary-container">
                ARCHIVE PILATES
              </h2>
            </div>
            <p className="text-surface/60 text-sm leading-relaxed mx-auto md:mx-0 max-w-sm">
              우리는 당신의 움직임을 기록하고, 삶을 정제합니다. <br />
              필라테스를 통한 새로운 아카이브를 시작하세요.
            </p>
            <div className="flex justify-center md:justify-start gap-6">
              <a
                href="https://www.instagram.com/archivepilates_official/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-surface/40 hover:text-primary-container transition-colors"
              >
                <Instagram size={20} />
              </a>
            </div>
          </div>

          <div className="md:col-span-3 space-y-6">
            <p className="text-[10px] uppercase tracking-widest text-surface/40">Contact</p>
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-primary-container shrink-0" />
                <p>부산광역시 강서구 명지국제2로28번길 34 에코팰리스 704호</p>
              </div>
              <div className="flex items-center gap-3">
                <Phone size={18} className="text-primary-container shrink-0" />
                <p>010-2924-4425</p>
              </div>
            </div>
          </div>

          <div className="md:col-span-4 space-y-6">
            <p className="text-[10px] uppercase tracking-widest text-surface/40">Recruitment</p>
            <p className="text-sm text-surface/60">
              인재 채용에 관한 문의는 아래 메일로 보내주세요.
            </p>
            <p className="text-primary-container font-medium">home@archivepilates.com</p>
          </div>
        </div>

        <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-surface/5 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] uppercase tracking-widest text-surface/30">
          <p>© 2024 Archive Pilates. All rights reserved.</p>
          <div className="flex gap-8">
            <a href="#" className="hover:text-surface transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-surface transition-colors">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
