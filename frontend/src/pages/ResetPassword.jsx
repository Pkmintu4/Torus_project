import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg({ text: '', type: '' });

    if (pwd1 !== pwd2) {
      setMsg({ text: 'Passwords do not match', type: 'error' });
      return;
    }

    if (!token) {
      setMsg({ text: 'Reset token missing from URL', type: 'error' });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('http://localhost:5002/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: pwd1 })
      });

      const data = await res.json();
      
      if (res.ok) {
        setMsg({ text: data.msg || 'Password updated successfully', type: 'success' });
        setSuccess(true);
      } else {
        setMsg({ text: data.msg || 'Failed to update password', type: 'error' });
      }
    } catch (err) {
      setMsg({ text: 'Failed to connect to server', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="header auth-header">
        <h1 className="main-title">Update Password</h1>
        <p className="subtitle">Assign a new password securely</p>
      </div>

      <div className="auth-card">
        {msg.text && (
          <div className={`alert ${msg.type === 'error' ? 'alert-error' : 'alert-success'}`}>
            {msg.text}
          </div>
        )}

        {!success ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>New Password</label>
              <div className="input-wrapper">
                <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <input type="password" className="form-control" placeholder="••••••••" required minLength="6" value={pwd1} onChange={e => setPwd1(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <div className="input-wrapper">
                <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                <input type="password" className="form-control" placeholder="••••••••" required minLength="6" value={pwd2} onChange={e => setPwd2(e.target.value)} />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginBottom: 16 }}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        ) : (
          <button className="btn btn-secondary" onClick={() => navigate('/login')}>
            Return to Login
          </button>
        )}
      </div>
    </div>
  );
}

export default ResetPassword;
