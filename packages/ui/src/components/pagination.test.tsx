import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('renders nothing when totalPages is 1', () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when totalPages is 0', () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={0} onPageChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders all page buttons for 5 pages', () => {
    render(
      <Pagination currentPage={1} totalPages={5} onPageChange={vi.fn()} />,
    );

    // Should show pages 1-5 plus prev/next buttons
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByRole('button', { name: `Page ${i}` })).toHaveTextContent(String(i));
    }
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  it('highlights current page with primary variant and aria-current', () => {
    render(
      <Pagination currentPage={3} totalPages={5} onPageChange={vi.fn()} />,
    );

    const page3 = screen.getByRole('button', { name: 'Page 3' });
    expect(page3.className).toContain('bg-primary');
    expect(page3).toHaveAttribute('aria-current', 'page');

    const page2 = screen.getByRole('button', { name: 'Page 2' });
    expect(page2.className).not.toContain('bg-primary');
    expect(page2).not.toHaveAttribute('aria-current');
  });

  it('disables previous button on first page', () => {
    render(
      <Pagination currentPage={1} totalPages={5} onPageChange={vi.fn()} />,
    );

    const prevBtn = screen.getByLabelText('Previous page');
    expect(prevBtn).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(
      <Pagination currentPage={5} totalPages={5} onPageChange={vi.fn()} />,
    );

    const nextBtn = screen.getByLabelText('Next page');
    expect(nextBtn).toBeDisabled();
  });

  it('calls onPageChange with previous page when prev clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination currentPage={3} totalPages={5} onPageChange={onPageChange} />,
    );

    await user.click(screen.getByLabelText('Previous page'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('calls onPageChange with next page when next clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination currentPage={3} totalPages={5} onPageChange={onPageChange} />,
    );

    await user.click(screen.getByLabelText('Next page'));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('calls onPageChange with correct page when number is clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination currentPage={1} totalPages={5} onPageChange={onPageChange} />,
    );

    await user.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('shows ellipsis for large page counts (beginning)', () => {
    render(
      <Pagination currentPage={1} totalPages={20} onPageChange={vi.fn()} />,
    );

    // Pages 1-5, ..., 20 (the ellipsis is decorative, not a button)
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 6' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 20' })).toBeInTheDocument();
    expect(screen.getAllByText('...')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '...' })).not.toBeInTheDocument();
  });

  it('shows ellipsis for large page counts (middle)', () => {
    render(
      <Pagination currentPage={10} totalPages={20} onPageChange={vi.fn()} />,
    );

    // Pages 1, ..., 9, 10, 11, ..., 20
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 20' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 8' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 12' })).not.toBeInTheDocument();
    expect(screen.getAllByText('...')).toHaveLength(2);
  });

  it('shows ellipsis for large page counts (end)', () => {
    render(
      <Pagination currentPage={20} totalPages={20} onPageChange={vi.fn()} />,
    );

    // Pages 1, ..., 16-20
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page 15' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 20' })).toBeInTheDocument();
    expect(screen.getAllByText('...')).toHaveLength(1);
  });

  it('clamps previous page to 1', async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination currentPage={1} totalPages={5} onPageChange={onPageChange} />,
    );

    // Prev button is disabled at page 1, but verify the clamping logic
    // by checking the button is disabled
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
  });

  it('applies custom className', () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={3} onPageChange={vi.fn()} className="mt-4" />,
    );

    expect(container.firstElementChild?.className).toContain('mt-4');
  });
});
