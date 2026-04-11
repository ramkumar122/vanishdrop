// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from './HomePage.jsx';
import { usePresence } from '../hooks/usePresence.js';
import { useSocket } from '../hooks/useSocket.js';
import { useUpload } from '../hooks/useUpload.js';

vi.mock('../hooks/useSocket.js', () => ({
  useSocket: vi.fn(),
}));

vi.mock('../hooks/useUpload.js', () => ({
  useUpload: vi.fn(),
}));

vi.mock('../hooks/usePresence.js', () => ({
  usePresence: vi.fn(),
}));

vi.mock('../components/DropZone.jsx', () => ({
  default: ({ disabled }) => <div data-disabled={String(disabled)} data-testid="drop-zone" />,
}));

vi.mock('../components/UploadProgress.jsx', () => ({
  default: () => <div data-testid="upload-progress" />,
}));

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePresence).mockImplementation(() => {});
    vi.mocked(useUpload).mockReturnValue({
      bytesUploaded: 0,
      completedFiles: 0,
      currentFileName: null,
      error: null,
      progress: 0,
      reset: vi.fn(),
      shareId: null,
      status: 'idle',
      totalFiles: 0,
      totalBytes: 0,
      uploadFiles: vi.fn(),
    });
  });

  it('shows the secure session loading state while the socket is connected but not ready', () => {
    vi.mocked(useSocket).mockReturnValue({
      connected: true,
      emit: vi.fn(),
      joinRoom: vi.fn(),
      on: vi.fn(),
      sessionError: null,
      sessionId: 'session-123',
      sessionReady: false,
      socket: null,
      status: 'connected',
    });

    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <HomePage />
      </MemoryRouter>
    );

    expect(screen.getByText('Preparing secure session…')).toBeInTheDocument();
    expect(screen.getByTestId('drop-zone')).toHaveAttribute('data-disabled', 'true');
  });

  it('shows the session bootstrap error and reload action', () => {
    vi.mocked(useSocket).mockReturnValue({
      connected: true,
      emit: vi.fn(),
      joinRoom: vi.fn(),
      on: vi.fn(),
      sessionError: 'Failed to initialize secure session. Please refresh and try again.',
      sessionId: 'session-123',
      sessionReady: false,
      socket: null,
      status: 'connected',
    });

    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <HomePage />
      </MemoryRouter>
    );

    expect(
      screen.getByText('Failed to initialize secure session. Please refresh and try again.')
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
