import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EditedIndicator from '../../../src/components/Shared/EditedIndicator';

describe('EditedIndicator', () => {
  it.each([null, undefined, ''])('renders nothing for %j', (editedAt) => {
    const { container } = render(<EditedIndicator editedAt={editedAt} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "edited {date}" with the full local timestamp as a tooltip', () => {
    const editedAt = '2026-03-04T15:30:00.000Z';
    render(<EditedIndicator editedAt={editedAt} />);

    const indicator = screen.getByText('edited Mar 4, 2026');
    expect(indicator).toHaveAttribute('title', new Date(editedAt).toLocaleString());
    expect(indicator).toHaveClass('text-muted', 'small');
  });

  it('accepts an extra className', () => {
    render(<EditedIndicator editedAt="2026-03-04T15:30:00.000Z" className="ms-2" />);
    expect(screen.getByText(/^edited /)).toHaveClass('ms-2');
  });
});
