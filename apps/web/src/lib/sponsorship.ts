// Sponsorship logic - ONLY to be used in ControlDeckPage

export const requestSponsorship = async (): Promise<void> => {
  // Implementation for requesting sponsorship
  console.log('Sponsorship requested');
};

export const getSponsorshipClient = () => {
  throw new Error('Sponsorship client should only be accessed via ControlDeckPage');
};
