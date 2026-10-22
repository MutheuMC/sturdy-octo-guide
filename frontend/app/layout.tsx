import "./globals.css";
export const metadata = {
  title: "pptinit — Your ideas, organized",
  description: "A home for your projects, presentations, and documents.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
