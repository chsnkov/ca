import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0b1020', color: '#e5e7eb', fontFamily: 'Arial, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
