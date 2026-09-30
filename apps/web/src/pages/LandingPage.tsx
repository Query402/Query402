import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Typography, Box } from '@mui/material';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Redirect to control deck for any paid actions
    navigate('/control-deck');
  };

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" gutterBottom>
        Query402
      </Typography>
      <Typography variant="body1" paragraph>
        Execute complex queries with precision. The landing page demonstrates
        functionality without initiating paid operations.
      </Typography>
      <form onSubmit={handleSubmit}>
        <Button type="submit" variant="contained" color="primary">
          Try a Query
        </Button>
      </form>
    </Box>
  );
};

export default LandingPage;