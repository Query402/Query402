import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../LandingPage';
import * as x402 from '../../lib/x402';
import * as sponsorship from '../../lib/sponsorship';

// Mock the payment and sponsorship modules
jest.mock('../../lib/x402');
jest.mock('../../lib/sponsorship');

describe('LandingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without calling payment client', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(x402.initiatePayment).not.toHaveBeenCalled();
    expect(sponsorship.requestSponsorship).not.toHaveBeenCalled();
  });

  it('submit control does not request a signature', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    const submitButton = screen.getByText('Try a Query');
    fireEvent.click(submitButton);

    expect(x402.initiatePayment).not.toHaveBeenCalled();
    expect(sponsorship.requestSponsorship).not.toHaveBeenCalled();
  });

  it('does not render raw payment headers', () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(container.textContent).not.toContain('Payment:');
    expect(container.textContent).not.toContain('Signature:');
  });
});
