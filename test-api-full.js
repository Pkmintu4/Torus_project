async function testFlow() {
  const email = 'manjulaejji4@gmail.com';
  const newPassword = 'NewPassword123!';
  let otp = null;

  try {
    console.log("--- 1. Send OTP ---");
    let res0 = await fetch('http://127.0.0.1:5002/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    let data0 = await res0.json();
    console.log("Response:", data0);
    otp = data0.otp;

    if (!otp) throw new Error("No OTP returned!");

    console.log("\n--- 2. Verify OTP ---");
    let res1 = await fetch('http://127.0.0.1:5002/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    let data1 = await res1.json();
    console.log("Response:", data1);
    if (!data1.success) throw new Error("Verify OTP failed");

    console.log("\n--- 3. Reset Password ---");
    let res2 = await fetch('http://127.0.0.1:5002/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword })
    });
    let data2 = await res2.json();
    console.log("Response:", data2);
    if (!data2.success) throw new Error("Reset password failed");

    console.log("\n--- 4. Login ---");
    let res3 = await fetch('http://127.0.0.1:5002/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: newPassword })
    });
    let data3 = await res3.json();
    console.log("Response:", data3);
    if (!data3.success) throw new Error("Login failed");

    console.log("\n✅ ALL END-TO-END STEPS PASSED!");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
  }
}

testFlow();
