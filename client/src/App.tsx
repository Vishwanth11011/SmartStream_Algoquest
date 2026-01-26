import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/Auth';
import { TransferRoom } from './components/TransferRoom';

// 🔒 PROTECTED ROUTE COMPONENT
// This wrapper checks if the user is logged in before letting them see the page.
const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const token = localStorage.getItem('token');
  
  if (!token) {
    // If no token, kick them back to Login
    return <Navigate to="/auth" replace />;
  }
  
  // If token exists, show the protected page (Dashboard)
  return children;
};

function App() {
  return (
    <Router>
      <Routes>
        {/* Route 1: The Login/Signup Page */}
        <Route path="/auth" element={<AuthPage />} />

        {/* Route 2: The Main Transfer App (Protected!) */}
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <TransferRoom />
            </ProtectedRoute>
          } 
        />

        {/* Route 3: Default Redirect */}
        {/* If user visits root "/", decide where to send them */}
        <Route 
          path="/" 
          element={<Navigate to={localStorage.getItem('token') ? "/dashboard" : "/auth"} replace />} 
        />
      </Routes>
    </Router>
  );
}

export default App;