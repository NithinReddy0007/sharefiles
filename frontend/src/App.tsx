import React, { useState } from 'react';
import { SendView } from './SendView';
import { ReceiveView } from './ReceiveView';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'home' | 'send' | 'receive'>('home');

  return (
    <div className="app-wrapper">
      {/* Site Header */}
      <header className="site-header">
        <button
          className="brand"
          onClick={() => setCurrentView('home')}
          aria-label="Go to Qshare homepage"
        >
          <svg className="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="brand-title">Qshare</span>
        </button>
      </header>

      {/* Main Container */}
      <main>
        {currentView === 'home' && (
          <div className="home-container">
            <h1 className="home-title">Qshare</h1>
            <p className="home-description">
              Send files securely. No account required.
            </p>

            <div className="home-actions">
              <button
                className="btn btn-primary"
                onClick={() => setCurrentView('send')}
              >
                <ArrowUpRight size={18} /> Send Files
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setCurrentView('receive')}
              >
                <ArrowDownLeft size={18} /> Receive Files
              </button>
            </div>

            <p className="home-notice">
              Rooms expire after 30 minutes.
            </p>
          </div>
        )}

        {currentView === 'send' && (
          <SendView onBack={() => setCurrentView('home')} />
        )}

        {currentView === 'receive' && (
          <ReceiveView onBack={() => setCurrentView('home')} />
        )}
      </main>
    </div>
  );
};

export default App;
