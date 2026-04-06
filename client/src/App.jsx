import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import SharePage from './pages/SharePage.jsx';
import DownloadPage from './pages/DownloadPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/share/:fileId" element={<SharePage />} />
          <Route path="/d/:fileId" element={<DownloadPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
