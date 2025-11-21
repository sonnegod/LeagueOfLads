import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";


export default function RequestPage() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");

  // Redirect if not logged in
  if (!user) return <Navigate to="/dashboard" />;

  const submitRequest = async () => {
    if (!message.trim()) {
      setResponse("Please enter a request.");
      return;
    }

    try {
      const res = await fetch("/api/user/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.accountId,    // <-- audit ID
          requestText: message,
        })
      });

      const data = await res.json();

      if (data.success) {
        setResponse("Your request has been submitted!");
        setMessage("");
      } else {
        setResponse("Something went wrong.");
      }
    } catch (err) {
      console.error(err);
      setResponse("Error submitting request.");
    }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "600px", margin: "0 auto" }}>
      <h2>Submit a Request</h2>

      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={10}
        style={{
          width: "100%",
          padding: "10px",
          fontSize: "14px",
          borderRadius: "6px",
          border: "1px solid #ccc"
        }}
        placeholder="Enter your request here..."
      />

      <button
        onClick={submitRequest}
        style={{
          marginTop: "15px",
          padding: "10px 20px",
          background: "#0077ff",
          border: "none",
          borderRadius: "6px",
          color: "white",
          cursor: "pointer"
        }}
      >
        Submit
      </button>

      {response && (
        <div style={{ marginTop: "12px", fontWeight: "bold" }}>
          {response}
        </div>
      )}
    </div>
  );
}
