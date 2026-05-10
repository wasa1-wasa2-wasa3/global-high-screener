'use client';
import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

export default function AuthCallback() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') window.location.replace('/');
    });
    const t = setTimeout(() => window.location.replace('/'), 5000);
    return () => { subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', fontSize: 14, color: '#888' }}>
      ログイン中...
    </div>
  );
}
