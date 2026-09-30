import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Typography, Box } from '@mui/material';
import { initiatePayment } from '../lib/x402';
import { requestSponsorship } from '../lib/sponsorship';

const ControlDeckPage: React.FC = () => {
  const navigate = useNavigate();

  const handlePaidQuery = async () => {
    try {
      await initiatePayment();
      // Proceed with paid query logic
    } catch (error) {
      console.error('Payment failed:', error);
    }
  };

  const handleSponsoredQuery = async () => {
    try {
      await requestSponsorship();
      // Proceed with sponsored query logic
    } catch (error) {
      console.error('Sponsorship failed:', error);
    }
  };

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" gutterBottom>
        Control Deck
      </Typography>
      <Typography variant="body1" paragraph>
        This is the control deck. Paid and sponsored queries start here.
      </Typography>
      <Button
        variant="contained"
        color="primary"
        onClick={handlePaidQuery}
        sx={{ mr: 2 }}
      >
        Start Paid Query
      </Button>
      <Button
        variant="contained"
        color="secondary"
        onClick={handleSponsoredQuery}
      >
        Request Sponsorship
      </Button>
    </Box>
  );
};

export default ControlDeckPage;