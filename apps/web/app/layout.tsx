import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Mafia Casefile',
  description: 'Mafia Casefile project web app',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
