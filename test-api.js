async function testFlow() {
  // 1. Send OTP
  console.log("--- Sending OTP ---");
  let res = await fetch('http://127.0.0.1:5002/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manjulaejji4@gmail.com' })
  });
  let data = await res.json();
  console.log(data);
}
testFlow();
