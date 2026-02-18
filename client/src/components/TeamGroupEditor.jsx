import React, { useState } from "react";

export default function TeamGroupEditor({ onTeamUpdated }) {
  const [teamId, setTeamId] = useState("");
  const [teamGroupId, setTeamGroupId] = useState("");

  const [groupLookupId, setGroupLookupId] = useState("");
  const [groupName, setGroupName] = useState("");

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveMode, setSaveMode] = useState("");

  const loadTeamGroup = async () => {
    if (!teamId.trim() || isNaN(teamId)) {
      setMessage("Enter a valid Team ID.");
      return;
    }

    setLoading(true);
    setMessage("");
    setSaveMode("team");

    try {
      const res = await fetch(`/api/admin/teamGroup/${Number(teamId)}`);
      const data = await res.json();
      const row = data?.result?.[0];

      if (row) {
        setTeamId(String(row.TeamId));
        setTeamGroupId(String(row.GroupId ?? ""));
        setMessage("Team group loaded.");
      } else {
        setTeamGroupId("");
        setMessage("No team group found for active league. Enter Group ID and save.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error loading team group.");
    } finally {
      setLoading(false);
    }
  };

  const saveTeamGroup = async () => {
    if (!teamId.trim() || isNaN(teamId)) {
      setMessage("Enter a valid Team ID.");
      return;
    }

    if (!teamGroupId.trim() || isNaN(teamGroupId)) {
      setMessage("Enter a valid Group ID.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/upsertTeamGroup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: Number(teamId),
          groupId: Number(teamGroupId)
        })
      });

      const data = await res.json();

      if (data.success) {
        setMessage(data.inserted ? "Team group inserted." : "Team group updated.");
        onTeamUpdated && onTeamUpdated();
      } else {
        setMessage(data.error || "Unable to save team group.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error saving team group.");
    } finally {
      setLoading(false);
    }
  };

  const loadGroupName = async () => {
    if (!groupLookupId.trim() || isNaN(groupLookupId)) {
      setMessage("Enter a valid Group ID to load name.");
      return;
    }

    setLoading(true);
    setMessage("");
    setSaveMode("group");

    try {
      const res = await fetch(`/api/admin/groupName/${Number(groupLookupId)}`);
      const data = await res.json();
      const row = data?.result?.[0];

      if (row) {
        setGroupName(row.GroupName ?? "");
        setMessage("Group name loaded.");
      } else {
        setGroupName("");
        setMessage("No group name found for active league. Enter a name and save.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error loading group name.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (saveMode === "team") {
      await saveTeamGroup();
      return;
    }

    if (saveMode === "group") {
      await saveGroupName();
      return;
    }

    setMessage("Load Team ID or Group ID first.");
  };

  const saveGroupName = async () => {
    if (!groupLookupId.trim() || isNaN(groupLookupId)) {
      setMessage("Enter a valid Group ID.");
      return;
    }

    if (!groupName.trim()) {
      setMessage("Group name cannot be empty.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/admin/upsertGroupName", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: Number(groupLookupId),
          groupName: groupName.trim()
        })
      });

      const data = await res.json();

      if (data.success) {
        setMessage(data.inserted ? "Group name inserted." : "Group name updated.");
      } else {
        setMessage(data.error || "Unable to save group name.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error saving group name.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={adminWidgetStyle}>
      <h3 style={{ textAlign: "center", marginBottom: "12px" }}>Team Group Editor</h3>

      <div style={sectionStyle}>
        <strong>Team Group</strong>

        <label>Team ID</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            style={{ flex: 1 }}
            placeholder="Enter Team ID"
          />
          <button onClick={loadTeamGroup} disabled={loading}>Load</button>
        </div>

        <label>Group ID</label>
        <input
          type="text"
          value={teamGroupId}
          onChange={(e) => setTeamGroupId(e.target.value)}
          style={{ width: "100%" }}
          placeholder="Set Group ID for Team"
        />

      </div>

      <div style={sectionStyle}>
        <strong>Group Name</strong>

        <label>Group ID</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={groupLookupId}
            onChange={(e) => setGroupLookupId(e.target.value)}
            style={{ flex: 1 }}
            placeholder="Enter Group ID"
          />
          <button onClick={loadGroupName} disabled={loading}>Load</button>
        </div>

        <label>Group Name</label>
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          style={{ width: "100%" }}
          placeholder="Enter Group Name"
        />

      </div>

      {message && (
        <div style={{ marginTop: "12px", color: "green", fontWeight: "bold" }}>
          {message}
        </div>
      )}

      <div style={{ fontSize: "12px", opacity: 0.8 }}>
        Save mode: {saveMode === "team" ? "Team Group" : saveMode === "group" ? "Group Name" : "None (load first)"}
      </div>

      <button onClick={handleSave} disabled={loading || !saveMode} style={saveButtonStyle}>
        {loading
          ? "Saving..."
          : saveMode === "team"
            ? "Save Team Group"
            : saveMode === "group"
              ? "Save Group Name"
              : "Save (Load first)"}
      </button>
    </div>
  );
}

const adminWidgetStyle = {
  height: "450px",
  display: "flex",
  flexDirection: "column",
  border: "1px solid #ccc",
  borderRadius: "8px",
  padding: "16px",
  boxSizing: "border-box",
  overflow: "auto",
  gap: "12px"
};

const sectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "8px"
};

const primaryButtonStyle = {
  width: "100%",
  padding: "8px",
  background: "#0077ff",
  color: "white",
  border: "none",
  borderRadius: "6px"
};

const saveButtonStyle = {
  ...primaryButtonStyle,
  marginTop: "auto"
};
