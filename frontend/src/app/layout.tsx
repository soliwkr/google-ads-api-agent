import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Google Ads AI Agent',
  description: 'Enterprise Google Ads management powered by Claude AI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#1a1a2e] text-gray-100 antialiased h-full">
        {children}
      </body>
    </html>
  )
}
