export const metadata = {
  title: 'Global High Screener | US Edition',
  description: 'US stock 52-week high screener for Nasdaq & NYSE',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, background: '#F8FAFC', WebkitFontSmoothing: 'antialiased' }}>
        {children}
      </body>
    </html>
  );
}
