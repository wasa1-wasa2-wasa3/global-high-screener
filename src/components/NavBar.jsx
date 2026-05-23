'use client';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/',          icon: '💵', label: 'スキャン' },
  { href: '/portfolio', icon: '📊', label: 'ポートフォリオ' },
];

export default function NavBar() {
  const path = usePathname();
  return (
    <>
      <nav className="tb-nav">
        {ITEMS.map(({ href, icon, label }) => {
          const active = path === href;
          return (
            <a key={href} href={href} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '8px 0 6px', textDecoration: 'none', gap: 3,
              color: active ? '#0A1628' : '#999', fontWeight: active ? 700 : 400, fontSize: 10,
              borderTop: active ? '2px solid #0A1628' : '2px solid transparent',
              boxSizing: 'border-box',
            }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
              <span>{label}</span>
            </a>
          );
        })}
      </nav>
      <style>{`
        .tb-nav {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: #fff; border-top: 1px solid #e5e5e5;
          display: none; z-index: 100;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        @media (max-width: 639px) {
          .tb-nav { display: flex; }
          .tb-main { padding-bottom: 72px !important; }
        }
      `}</style>
    </>
  );
}
