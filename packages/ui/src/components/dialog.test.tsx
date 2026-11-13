import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Dialog } from './dialog';

describe('Dialog', () => {
  // Two buttons are named "Close": the footer button and Radix's X button (whose
  // label is an sr-only span). Only the footer button has "Close" as its own text.
  const getFooterCloseButton = () => screen.getByText('Close', { selector: 'button' });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    title: 'Test Dialog',
    children: <p>Dialog content</p>,
  };

  it('renders title and children when open', () => {
    render(<Dialog {...defaultProps} />);
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog content')).toBeInTheDocument();
  });

  it('does not render when closed and not visible', () => {
    render(<Dialog {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Test Dialog')).not.toBeInTheDocument();
  });

  it('shows footer with close button by default', () => {
    render(<Dialog {...defaultProps} />);
    expect(getFooterCloseButton()).toBeInTheDocument();
    // Footer close button + X close button
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2);
  });

  it('hides footer when showFooter is false', () => {
    render(<Dialog {...defaultProps} showFooter={false} />);
    // Only the X button should be present, not the Close button in footer
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1); // Only the X close button
  });

  it('uses custom close text', () => {
    render(<Dialog {...defaultProps} closeText="Dismiss" />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('calls onClose when footer close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog {...defaultProps} onClose={onClose} />);

    await user.click(getFooterCloseButton());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog {...defaultProps} onClose={onClose} showFooter={false} />);

    // X button is the only button
    await user.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog {...defaultProps} onClose={onClose} />);

    // The backdrop overlay has bg-black/60 class (Radix portals it to document.body)
    const overlay = document.body.querySelector('.bg-black\\/60');
    expect(overlay).toBeInTheDocument();
    await user.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies size class correctly', () => {
    render(<Dialog {...defaultProps} size="sm" />);
    const dialogPanel = screen.getByRole('dialog');
    expect(dialogPanel).toHaveClass('max-w-sm');
    expect(dialogPanel).not.toHaveClass('max-w-lg');
  });

  it('defaults to lg size', () => {
    render(<Dialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toHaveClass('max-w-lg');
  });
});
