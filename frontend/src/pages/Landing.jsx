import { useNavigate } from 'react-router-dom';

function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing-container">
      <div className="header">
        <div className="logo-wrapper">
          <img src="/logo.png" className="main-logo" alt="Main Logo" />
        </div>
        <h1 className="main-title">TORUS</h1>
        <h2 className="subtitle">REMOTE ULTRASOUND SYSTEM</h2>
        <p className="tagline">Next-Generation Healthcare Robotics Platform</p>
      </div>

      <div className="cards">
        <div className="card doctor">
          <div className="icon-box">
            <img src="/doctor-icon.png" className="icon-img" alt="Doctor" />
          </div>
          <h3 className="card-title">Doctor Session</h3>
          <p className="card-desc">
            Access your dashboard to perform remote ultrasound examinations, monitor active sessions, and manage patient consultations.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>
            Doctor Portal
          </button>
        </div>

        <div className="card diagnostic">
          <div className="icon-box diagnostic">
            <img src="/diagnostic-icon.png" className="icon-img" alt="Diagnostic" />
          </div>
          <h3 className="card-title">Diagnostic Center</h3>
          <p className="card-desc">
            Manage patient preparation, monitor TORUS device status, and coordinate with doctors for remote examination sessions.
          </p>
          <button className="btn btn-primary" onClick={(e) => e.preventDefault()}>
            Diagnostic Center
          </button>
        </div>
      </div>

      <div style={{ marginTop: '50px', textAlign: 'center', paddingBottom: '20px' }}>
        <p style={{ color: '#9CA3AF', fontSize: '14px', fontWeight: 400, margin: 0 }}>
          Secure &bull; HIPAA Compliant &bull; Real-Time Monitoring
        </p>
      </div>
    </div>
  );
}

export default Landing;
