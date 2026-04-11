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
          <Route path="/share/:shareId" element={<SharePage />} />
          <Route path="/d/:shareId" element={<DownloadPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
