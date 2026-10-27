import Link from "next/link";

/** 品牌标识：一页纸 + 环绕的轨道 */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#a3b1ff" />
        </linearGradient>
      </defs>
      <rect x="10" y="7" width="12" height="18" rx="2.5" fill="none" stroke="url(#logo-g)" strokeWidth="1.8" />
      <path d="M13.5 12h5M13.5 15.5h5M13.5 19h3" stroke="#a3b1ff" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
      <ellipse cx="16" cy="16" rx="14" ry="5.5" transform="rotate(-24 16 16)" fill="none" stroke="#a3b1ff" strokeWidth="1" opacity="0.55" />
      <circle cx="28.2" cy="10.6" r="1.6" fill="#fff" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
      <LogoMark />
      论文星图
    </Link>
  );
}
