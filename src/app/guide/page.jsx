'use client';
import { useEffect } from 'react';
import AuthButton from '../../components/AuthButton';

const NAVY  = '#0A1628';
const NAVY2 = '#1E3A5F';
const GOLD  = '#C9A84C';
const GOLD2 = '#F0C040';
const GUIDE_KEY = 'guide_seen_us_v1';

function navStyle(active) {
  return {
    fontSize: 13, padding: '6px 14px', borderRadius: 7,
    textDecoration: 'none',
    background: active ? '#fff' : 'transparent',
    color: active ? NAVY : '#888',
    fontWeight: active ? 600 : 400,
    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
    whiteSpace: 'nowrap',
  };
}

const STEPS = [
  {
    num: '01',
    label: 'FIND',
    icon: '🔍',
    title: 'スキャンで候補を発見',
    subtitle: '52週高値圏の銘柄を毎日チェック',
    body: '「USスキャン」で52週高値の90%以上に位置する銘柄を抽出。出来高急増（2倍以上）×高値ブレイクが最強シグナル。',
    action: 'スコア上位 & 🔴 Breakout シグナルの銘柄を★でウォッチリストへ',
    benefit: '毎日5分でUS市場の「今ホットな銘柄」を把握できる',
    grad: `linear-gradient(135deg,${NAVY} 0%,${NAVY2} 100%)`,
    accent: GOLD,
  },
  {
    num: '02',
    label: 'PROTECT',
    icon: '🛡️',
    title: 'リスク管理を設定',
    subtitle: '損切り -10% を必ず守る',
    body: 'US株は値動きが大きい。購入後は必ず「逆指値注文 @ 購入価格 × 0.90」を入れる。感情的な判断を排除することが長期成功の鍵。',
    action: '購入直後に証券会社のアプリで逆指値を設定。忘れずに！',
    benefit: '1回の損失を -10% に抑えることで、資産を守り続けられる',
    grad: 'linear-gradient(135deg,#1E40AF 0%,#1D4ED8 100%)',
    accent: '#93C5FD',
  },
  {
    num: '03',
    label: 'HARVEST',
    icon: '🌾',
    title: '元本を回収する（恩株化）',
    subtitle: '+20% で購入コスト分を売却',
    body: '株価が +20% になったら、最初に投資した金額と同額の株数を売却。残りの株は「タダでもらった株（恩株）」になり、損切りが不要になる。',
    action: '含み益 +20% で利確 → 元本を回収 → 残りはリスクゼロで保有',
    benefit: '元本を回収した後は、株価が0になっても損失ゼロ！',
    grad: 'linear-gradient(135deg,#065F46 0%,#047857 100%)',
    accent: '#6EE7B7',
  },
  {
    num: '04',
    label: 'DREAM',
    icon: '🚀',
    title: '恩株を夢の資産に育てる',
    subtitle: 'リスクゼロで10倍・100倍を狙う',
    body: '恩株化した後は、いくら株価が下がっても損失ゼロ。NVIDIAやAAPLのような銘柄を手放さずに持ち続けることで、10倍・100倍のリターンを狙える。',
    action: 'ポートフォリオ画面で恩株の年間配当を確認し、再投資計画を立てる',
    benefit: '恩株からの配当で新しい投資資金が生まれる「永久機関」の完成',
    grad: `linear-gradient(135deg,#92400E 0%,#B45309 100%)`,
    accent: GOLD2,
  },
];

const FAQS = [
  {
    q: 'どの銘柄から始めればいいですか？',
    a: 'スキャン結果でスコアが高く、🔴 Breakout シグナルがついている銘柄が最優先候補です。初心者はNVDA・AAPL・MSFTなど時価総額 $500B 以上の大型株から始めると値動きが読みやすいです。',
  },
  {
    q: '1回にいくら投資すればよいですか？',
    a: '1銘柄あたり総資産の5〜10%が目安です。損切り -10% が発動しても総資産の0.5〜1%しか失わない金額設定にしましょう。',
  },
  {
    q: '日本株と米国株の違いは何ですか？',
    a: 'US株は①24時間ニュースで動く ②1株から買える ③円安が追い風になる という特徴があります。一方、為替リスク（円高で目減り）と決算ギャップダウンリスクに注意が必要です。',
  },
  {
    q: '損切り -10% を守れなかったらどうなりますか？',
    a: '「-10% で止まっていれば -10% の損失で済んだものが、-30%・-50% まで引っ張ってしまう」ことが最大の失敗パターンです。逆指値注文（ストップロス注文）を事前に入れておくことで感情を排除できます。',
  },
];

export default function GuidePage() {
  useEffect(() => {
    localStorage.setItem(GUIDE_KEY, '1');
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: '#0F172A', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', gap: 8, marginBottom: '1.5rem', marginLeft: '-1rem', marginRight: '-1rem', width: 'calc(100% + 2rem)' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>📖 ガイド</span>
        <nav style={{ display: 'flex', gap: 2, overflowX: 'auto', flexShrink: 1, minWidth: 0 }}>
          {[
            { href: '/',          label: 'USスキャン', active: false },
            { href: '/portfolio', label: 'PF',         active: false },
            { href: '/guide',     label: 'ガイド',     active: true  },
          ].map(({ href, label, active }) => (
            <a key={href} href={href} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap', background: active ? 'rgba(255,255,255,0.12)' : 'transparent', color: active ? '#fff' : '#94A3B8', fontWeight: active ? 600 : 400 }}>{label}</a>
          ))}
          <a href="https://new-high-screener.vercel.app" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, textDecoration: 'none', background: '#1D4ED8', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 4 }}>🗾 JP ↗</a>
        </nav>
        <AuthButton />
      </div>

      {/* Hero */}
      <div style={{ background: `linear-gradient(160deg,${NAVY} 0%,${NAVY2} 100%)`, borderRadius: 20, padding: '40px 28px 48px', marginBottom: 32, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -60, right: -60, width: 240, height: 240, borderRadius: '50%', background: 'rgba(201,168,76,0.1)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -80, left: -80, width: 300, height: 300, borderRadius: '50%', background: 'rgba(201,168,76,0.07)', pointerEvents: 'none' }} />
        <div style={{ fontSize: 11, letterSpacing: 4, color: GOLD, fontWeight: 700, marginBottom: 12, position: 'relative' }}>VICTORY FORMULA</div>
        <div style={{ fontSize: 13, letterSpacing: 3, fontWeight: 800, color: '#fff', marginBottom: 10, position: 'relative', background: 'rgba(255,255,255,0.1)', display: 'inline-block', padding: '5px 16px', borderRadius: 20 }}>★ US STOCKS ★</div>
        <h1 style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 700, color: '#fff', position: 'relative' }}>US株 勝利の方程式</h1>
        <p style={{ margin: '12px 0 0', fontSize: 14, color: '#94A3B8', position: 'relative', lineHeight: 1.7 }}>
          52週高値 × 恩株化戦略で<br />リスクゼロの資産を増やし続ける4ステップ
        </p>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
        {STEPS.map((s) => (
          <div key={s.num} style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div style={{ background: s.grad, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>
                {s.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, letterSpacing: 2, color: s.accent, fontWeight: 700, marginBottom: 3 }}>
                  STEP {s.num} — {s.label}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{s.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{s.subtitle}</div>
              </div>
            </div>
            <div style={{ background: '#fff', padding: '16px 20px' }}>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: '#374151', lineHeight: 1.7 }}>{s.body}</p>
              <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: 1, marginBottom: 4 }}>NEXT ACTION</div>
                <div style={{ fontSize: 13, color: '#1E293B', fontWeight: 600 }}>{s.action}</div>
              </div>
              <div style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>✓ {s.benefit}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Flow chart */}
      <div style={{ background: '#fff', borderRadius: 16, padding: '20px 24px', marginBottom: 28, border: '1px solid #E2E8F0' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 14, textAlign: 'center' }}>📊 運用フロー一覧</div>
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
          {[
            { step: 'SCAN', label: '毎日スキャン', icon: '🔍', color: NAVY },
            { step: '→', label: '', icon: '', color: 'transparent' },
            { step: 'BUY', label: '逆指値を同時設定', icon: '🛒', color: '#1E40AF' },
            { step: '→', label: '', icon: '', color: 'transparent' },
            { step: '+20%', label: '元本回収・恩株化', icon: '🌾', color: '#065F46' },
            { step: '→', label: '', icon: '', color: 'transparent' },
            { step: 'HOLD', label: '永久保有・夢を育てる', icon: '🚀', color: '#92400E' },
          ].map((item, i) => (
            item.step === '→'
              ? <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '0 4px', color: '#94A3B8', fontSize: 18 }}>→</div>
              : <div key={i} style={{ flex: 1, minWidth: 70, textAlign: 'center' }}>
                  <div style={{ background: item.color, borderRadius: 10, padding: '8px 6px', marginBottom: 6 }}>
                    <div style={{ fontSize: 18 }}>{item.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginTop: 3 }}>{item.step}</div>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B', lineHeight: 1.4 }}>{item.label}</div>
                </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>❓ よくある質問</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {FAQS.map((faq, i) => (
            <details key={i} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
              <summary style={{ padding: '14px 18px', fontSize: 14, fontWeight: 600, color: NAVY, cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {faq.q}
                <span style={{ fontSize: 18, color: '#94A3B8', flexShrink: 0, marginLeft: 8 }}>＋</span>
              </summary>
              <div style={{ padding: '0 18px 16px', fontSize: 14, color: '#374151', lineHeight: 1.7 }}>{faq.a}</div>
            </details>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ background: `linear-gradient(135deg,${NAVY} 0%,${NAVY2} 100%)`, borderRadius: 20, padding: '32px 24px', textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🚀</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>さあ、US株投資を始めよう</h2>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#94A3B8', lineHeight: 1.6 }}>
          1日5分のスキャン習慣が<br />あなたの資産を変える第一歩です
        </p>
        <a href="/"
          style={{ display: 'inline-block', padding: '13px 32px', borderRadius: 12, background: `linear-gradient(135deg,${GOLD},${GOLD2})`, color: NAVY, textDecoration: 'none', fontWeight: 700, fontSize: 15, boxShadow: '0 4px 14px rgba(201,168,76,0.4)' }}>
          📈 USスキャンを開始する
        </a>
      </div>
    </main>
  );
}
