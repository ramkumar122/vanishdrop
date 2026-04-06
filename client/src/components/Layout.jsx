import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <header className="py-4 px-6 border-b border-gray-800">
        <a href="/" className="text-lg font-bold text-white tracking-tight hover:text-indigo-400 transition-colors">
          💨 VanishDrop
        </a>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <Outlet />
      </main>

      <footer className="py-4 px-6 text-center text-gray-600 text-xs border-t border-gray-900">
        Files vanish the moment you close your tab. No accounts. No storage. No trace.
      </footer>
    </div>
  );
}
