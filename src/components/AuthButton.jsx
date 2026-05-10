'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const NAVY = '#0A1628';
const GOLD = '#C9A84C';

export default function AuthButton() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail]     = useState('');
  const [sent, setSent]       = useState(false);
  const [sending, setSending] = useState(false);
  const [open, setOpen]       = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSend() {
    if (!email) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setSending(false);
    if (!error) setSent(true);
  }

  if (loading) return <span style={{ width: 80, display: 'inline-block' }} />;

  if (user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#64748B', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.email}
        </span>
        <button onClick={() => supabase.auth.signOut()}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', color: '#888', whiteSpace: 'nowrap' }}>
          ログアウト
        </button>
      </div>
    );
  }

  if (sent) {
    return <span style={{ fontSize: 12, color: '#059669', whiteSpace: 'nowrap' }}>✅ メールを送信しました</span>;
  }

  if (open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="email" placeholder="メールアドレス" value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          autoFocus
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid #E2E8F0', width: 190, outline: 'none' }} />
        <button onClick={handleSend} disabled={sending || !email}
          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: 'none', background: NAVY, color: '#fff', cursor: sending ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
          {sending ? '送信中...' : '送信'}
        </button>
        <button onClick={() => setOpen(false)}
          style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', color: '#aaa' }}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setOpen(true)}
      style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: `1px solid ${GOLD}`, background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap', color: NAVY, fontWeight: 600 }}>
      🔑 ログイン
    </button>
  );
}
