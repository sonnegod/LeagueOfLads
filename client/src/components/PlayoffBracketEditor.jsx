import React, { useState, useEffect } from 'react';

// ==========================================
// SECTION 1: THE BRACKET GENERATOR (PURE JS)
// ==========================================

const generatePlayoffBracket = (teams) => {
  const ubTeams = teams.filter(t => t.Bracket === 'upper');
  const lbTeams = teams.filter(t => t.Bracket === 'lower');

  // Ensure UB is power of 2 (8, 16, etc). If not, bye logic would be needed here.
  const ubCount = ubTeams.length;
  const lbStartCount = lbTeams.length;
  
  // Math: UB Rounds = Log2(N)
  const ubRounds = Math.ceil(Math.log2(ubCount));
  
  // Math: LB Rounds = (UB Rounds * 2) + 1 (The Extended Format)
  // Logic: 2 LB rounds for every 1 UB round (Consolidate -> Drop), plus finals.
  const lbRounds = (ubRounds * 2) + 1;

  const structure = {
    upperBracket: [],
    lowerBracket: [],
    grandFinals: []
  };

  // --- 1. UPPER BRACKET GENERATION ---
  for (let r = 1; r <= ubRounds; r++) {
    const matchCount = ubCount / Math.pow(2, r);
    const matches = [];

    for (let m = 1; m <= matchCount; m++) {
      matches.push({
        id: `ub-r${r}-m${m}`,
        bracket: 'upper',
        round: r,
        matchNum: m,
        team1Id: null, // Admin fills R1
        team1Name: null,
        team2Id: null, // Admin fills R1
        team2Name: null,
        // DROP LOGIC: UB R1 -> LB R3, UB R2 -> LB R5, etc.
        loserTo: `lb-r${(r * 2) + 1}-m${m}`,
        // WINNER LOGIC: Standard Pyramid
        winnerTo: r < ubRounds ? `ub-r${r+1}-m${Math.ceil(m/2)}` : 'gf-m1',
        // Destination Slot Logic: Odd matches -> Slot 1, Even matches -> Slot 2
        winnerToSlot: Math.ceil(m % 2) === 1 ? 1 : 2,
        team1Score: 0,
        team2Score: 0,
        seriesId: null
      });
    }
    structure.upperBracket.push({ round: r, matches });
  }

  // --- 2. LOWER BRACKET GENERATION ---
  // We start with LB Teams / 2 matches (e.g., 16 teams -> 8 matches)
  let currentMatchCount = lbStartCount / 2;

  for (let r = 1; r <= lbRounds; r++) {
    // CONSOLIDATION CHECK: Halve matches on even rounds (2, 4, 6...)
    if (r > 1 && r % 2 === 0) {
      currentMatchCount = currentMatchCount / 2;
    }
    
    // Safety break if math goes weird
    if (currentMatchCount < 1) break;

    // DROP CHECK: Odd rounds starting at R3 receive UB losers
    const isDropRound = (r > 2 && r % 2 !== 0); 
    const matches = [];

    for (let m = 1; m <= currentMatchCount; m++) {
      const match = {
        id: `lb-r${r}-m${m}`,
        bracket: 'lower',
        round: r,
        matchNum: m,
        team1Id: null,
        team2Id: null,
        isDropRound: isDropRound,
        team1Score: 0,
        team2Score: 0,
        loserTo: null, // Eliminated
        seriesId: null
      };

      // --- LB Winner Path ---
      const nextRound = r + 1;
      if (nextRound > lbRounds) {
        // To Grand Finals
        match.winnerTo = 'gf-m1';
        match.winnerToSlot = 2; // Usually UB winner is slot 1, LB winner slot 2
      } else {
        // If next is Drop (Odd), match count is same (1-to-1 mapping)
        // If next is Consolidation (Even), match count halves (2-to-1 mapping)
        const isNextRoundDrop = (nextRound > 2 && nextRound % 2 !== 0);
        
        if (isNextRoundDrop) {
          // 1-to-1 mapping to Slot 1 (Slot 2 is reserved for UB Drop)
          match.winnerTo = `lb-r${nextRound}-m${m}`;
          match.winnerToSlot = 1; 
        } else {
          // 2-to-1 mapping
          match.winnerTo = `lb-r${nextRound}-m${Math.ceil(m/2)}`;
          match.winnerToSlot = Math.ceil(m % 2) === 1 ? 1 : 2;
        }
      }

      // Explicitly label where the UB Drop comes from for the UI
      if (isDropRound) {
        match.dropSourceRound = (r - 1) / 2; // e.g., LB R3 gets UB R1
      }

      matches.push(match);
    }
    structure.lowerBracket.push({ round: r, matches });
  }

  // --- 3. GRAND FINALS ---
  structure.grandFinals.push({
    id: 'gf-m1',
    bracket: 'grand',
    round: 1,
    team1Id: null, // From UB
    team2Id: null, // From LB
    team1Score: 0,
    team2Score: 0,
    seriesId: null
  });

  return structure;
};

// ==========================================
// SECTION 2: THE COMPONENT
// ==========================================

const PlayoffBracketEditor = () => {
  const [loading, setLoading] = useState(true);
  const [bracket, setBracket] = useState(null);
  const [existing, setExisting] = useState(null);

  const [teams, setTeams] = useState([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const init = async () => {

      const res = await fetch('/api/admin/playoffBracket');
      const data = await res.json();

      console.log(data.playoffBracket);

      // Simulate checking for existing bracket
      const existingBracket = JSON.stringify(data.playoffBracket); // Set this to response.bracket if exists

      setTeams(data.result);


      if (existingBracket) {
        setBracket(data.playoffBracket);
        setExisting(true)
        setLoading(false);

      } else {
        // Generate Fresh Logic
        const newStruct = generatePlayoffBracket(data.result);
        setBracket(newStruct);
        setExisting(false);
        setLoading(false);

      }
      setLoading(false);
    };

    init();
  }, []);

  // --- CORE LOGIC: UPDATE MATCH & ADVANCE TEAMS ---
  const updateMatch = (matchId, field, value) => {
    setDirty(true);
    const newBracket = JSON.parse(JSON.stringify(bracket)); // Deep Clone

    // 1. Helper to find match in the tree
    let targetMatch = null;
    let category = null;
    
    // Search UB
    for (const r of newBracket.upperBracket) {
      const found = r.matches.find(m => m.id === matchId);
      if (found) { targetMatch = found; category = 'upperBracket'; break; }
    }
    // Search LB
    if (!targetMatch) {
      for (const r of newBracket.lowerBracket) {
        const found = r.matches.find(m => m.id === matchId);
        if (found) { targetMatch = found; category = 'lowerBracket'; break; }
      }
    }
    // Search GF
    if (!targetMatch) {
        const found = newBracket.grandFinals.find(m => m.id === matchId);
        if(found) { targetMatch = found; category = 'grandFinals'; }
    }

    if (!targetMatch) return;

    // 2. Update the field (Score or Manual Team selection)
    targetMatch[field] = value;

    if (field === 'team1Id' || field === 'team2Id') {
        // 1. LOOKUP: Finds the team object using the ID passed from the dropdown (value)
        const team = teams.find(t => t.TeamId === parseInt(value)); 
        
        // 2. PROPERTY MAP: Determines the destination name field
        const nameField = field.replace('Id', 'Name'); 
        
        // 3. STORAGE: Sets BOTH the ID and the corresponding Name
        targetMatch[nameField] = team ? team.TeamName : null; 
    }

    // 3. AUTO-ADVANCEMENT LOGIC
    // Only run if we have two valid teams and scores
    if (targetMatch.team1Id && targetMatch.team2Id) {
      const s1 = parseInt(targetMatch.team1Score || 0);
      const s2 = parseInt(targetMatch.team2Score || 0);

      if (s1 !== s2) {
        const winnerId = s1 > s2 ? targetMatch.team1Id : targetMatch.team2Id;
        const loserId = s1 > s2 ? targetMatch.team2Id : targetMatch.team1Id;

        const winnerName = s1 > s2 ? targetMatch.team1Name : targetMatch.team2Name;
        const loserName = s1 > s2 ? targetMatch.team2Name : targetMatch.team1Name;

        // A. Handle Winner
        if (targetMatch.winnerTo) {
          updateTargetMatch(newBracket, targetMatch.winnerTo, targetMatch.winnerToSlot, winnerId, winnerName);
        }

        // B. Handle Loser (Only for Upper Bracket)
        if (targetMatch.loserTo) {
          // In Drop rounds, UB losers usually go to Slot 2
          updateTargetMatch(newBracket, targetMatch.loserTo, 2, loserId, loserName);
        }
      }
    }

    setBracket(newBracket);
  };

  // Helper to find a future match and set its team
  const updateTargetMatch = (bracketObj, matchId, slot, teamId, teamName) => {
    console.log(teamName);
    // Flatten search
    const allMatches = [
      ...bracketObj.upperBracket.flatMap(r => r.matches),
      ...bracketObj.lowerBracket.flatMap(r => r.matches),
      ...bracketObj.grandFinals
    ];
    
    const m = allMatches.find(x => x.id === matchId);
    if (m) {
      if (slot === 1) {
        m.team1Id = teamId;
        m.team1Name = teamName
      }
      if (slot === 2) {
        m.team2Id = teamId;
        m.team2Name = teamName
      }
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch("/api/admin/saveBracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body : JSON.stringify({
                bracketData: bracket, 
            }),
      });

      console.log(res)

      if (res.ok) {
            setDirty(false);
            console.log("Bracket saved successfully!");

        } else {
            console.error("Save failed:");
            alert("Error saving bracket data.");
      }
    }
    catch(err) {
        console.error(err);
    }

    
    setDirty(false);
  };

  if (loading) return <div style={styles.loading}>Generating Bracket Structure...</div>;

  if (!bracket || existing === null) {
    return <div>Loading bracket data...</div>; // Show a loader or null
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={handleSave} style={styles.saveBtn}>Save Bracket</button>
        {dirty && <span style={styles.unsaved}>Unsaved Changes</span>}
      </div>

      <div style={styles.board}>
        {/* --- UPPER BRACKET ROW --- */}
        <div style={styles.bracketRow}>
          <div style={styles.bracketLabel}>Upper Bracket</div>
          <div style={styles.roundsContainer}>
            {bracket.upperBracket.map((round) => (
              <RoundColumn key={round.round} title={`Round ${round.round}`}>
                {round.matches.map(m => (
                  <MatchCard 
                    key={m.id} 
                    match={m} 
                    teams={teams} 
                    onUpdate={updateMatch}
                    manualSelect={m.round === 1} // Only R1 is manually selectable
                    existing = {existing}
                  />
                ))}
              </RoundColumn>
            ))}
            
            {/* Grand Finals (Visual Placement) */}
            <RoundColumn title="Grand Finals">
                 <MatchCard 
                    match={bracket.grandFinals[0]} 
                    teams={teams} 
                    onUpdate={updateMatch}
                    manualSelect={false}
                    isGrandFinal
                    existing = {existing}
                 />
            </RoundColumn>
          </div>
        </div>

        {/* --- DIVIDER --- */}
        <hr style={{borderColor: '#444', margin: '30px 0'}} />

        {/* --- LOWER BRACKET ROW --- */}
        <div style={styles.bracketRow}>
          <div style={styles.bracketLabel}>Lower Bracket</div>
          <div style={styles.roundsContainer}>
            {bracket.lowerBracket.map((round) => (
              <RoundColumn key={round.round} title={`Round ${round.round}`}>
                {round.matches.map(m => (
                  <MatchCard 
                    key={m.id} 
                    match={m} 
                    teams={teams} 
                    onUpdate={updateMatch}
                    manualSelect={m.round === 1}
                    existing = {existing}
                  />
                ))}
              </RoundColumn>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// SECTION 3: SUB-COMPONENTS & STYLES
// ==========================================

const RoundColumn = ({ title, children }) => (
  <div style={styles.column}>
    <h4 style={styles.colTitle}>{title}</h4>
    <div style={styles.colBody}>{children}</div>
  </div>
);

const MatchCard = ({ match, teams, onUpdate, manualSelect, isGrandFinal, existing }) => {
  
  const isTeamSelectionLocked = existing

  // Filter teams for initial dropdowns
  let ubTeams = [];
  let lbTeams = [];
  let selectionPool = [];
  if(!existing && teams){
    ubTeams = teams.filter(t => t.Bracket === 'upper');
    lbTeams = teams.filter(t => t.Bracket === 'lower');
    selectionPool = match.bracket === 'upper' ? ubTeams : lbTeams;
  }

  // Visual cues
  const isDropRound = match.isDropRound;
  const cardStyle = {
    ...styles.card,
    borderLeft: isDropRound ? '4px solid #ff6b6b' : '4px solid #4ecdc4',
    borderColor: isGrandFinal ? 'gold' : '#ccc'
  };

  return (
    <div style={cardStyle}>
      <div style={styles.cardHeader}>
        <span>M{match.matchNum}</span>
        {isDropRound && <span style={styles.dropLabel}>UB Drop</span>}
      </div>

      {/* TEAM 1 ROW */}
      <TeamRow 
        slot={1}
        teamId={match.team1Id}
        teamName={match.team1Name}
        score={match.team1Score}
        manualSelect={!isTeamSelectionLocked && manualSelect}
        pool={selectionPool}
        onChange={(val) => onUpdate(match.id, 'team1Id', val)}
        onScore={(val) => onUpdate(match.id, 'team1Score', val)}
        readOnlyName={!manualSelect && match.team1Id}
        placeholder={manualSelect ? "Select Team" : (match.bracket==='lower' && match.winnerToSlot===1 && match.round > 1 ? "Winner LB" : "Winner/Seed")}
      />

      {/* TEAM 2 ROW */}
      <TeamRow 
        slot={2}
        teamId={match.team2Id}
        teamName={match.team2Name}
        score={match.team2Score}
        manualSelect={!isTeamSelectionLocked && manualSelect}
        pool={selectionPool}
        onChange={(val) => onUpdate(match.id, 'team2Id', val)}
        onScore={(val) => onUpdate(match.id, 'team2Score', val)}
        readOnlyName={!manualSelect && match.team2Id}
        placeholder={isDropRound ? "UB Loser" : (manualSelect ? "Select Team" : "Winner/Seed")}
      />
    </div>
  );
};

const TeamRow = ({ slot, teamId, teamName, score, manualSelect, pool, onChange, onScore, readOnlyName, placeholder, teamNameResolver }) => (
  <div style={styles.teamRow}>
    <div style={styles.teamName}>
      {manualSelect ? (
        <select value={teamId || ''} onChange={(e) => onChange(e.target.value)} style={styles.select}>
          <option value="">{placeholder}</option>
          {pool.map(t => <option key={t.TeamId} value={t.TeamId}>{t.TeamName}</option>)}
        </select>
      ) : (
        <span style={{ color: teamId ? '#000' : '#999', fontSize: '12px' }}>
          {teamId ? teamName : placeholder}
        </span>
      )}
    </div>
    <input 
      type="number" 
      value={score} 
      onChange={(e) => onScore(e.target.value)}
      style={styles.scoreInput}
      min="0"
    />
  </div>
);

// --- CSS-IN-JS STYLES ---
const styles = {
  container: {
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    backgroundColor: '#f4f6f8',
    minHeight: '100vh',
    overflowX: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'flex-start',
    gap: '20px',
    alignItems: 'center',
    marginBottom: '20px',
    padding: '10px',
    background: '#fff',
    borderBottom: '1px solid #ddd'
  },
  saveBtn: {
    padding: '10px 20px',
    backgroundColor: '#2ecc71',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  unsaved: {
    color: '#e74c3c',
    fontWeight: 'bold',
    marginRight: '20px'
  },
  board: {
    display: 'flex',
    flexDirection: 'column',
    overflowX: 'auto',
    paddingBottom: '50px'
  },
  bracketRow: {
    marginBottom: '20px'
  },
  bracketLabel: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '10px',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#34495e'
  },
  roundsContainer: {
    display: 'flex',
    gap: '40px'
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: '220px'
  },
  colTitle: {
    textAlign: 'center',
    marginBottom: '15px',
    color: '#7f8c8d'
  },
  colBody: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-around',
    flexGrow: 1
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '6px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    marginBottom: '20px',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px'
  },
  cardHeader: {
    fontSize: '10px',
    color: '#95a5a6',
    display: 'flex',
    justifyContent: 'space-between',
    textTransform: 'uppercase',
    fontWeight: 'bold',
    marginBottom: '4px'
  },
  dropLabel: {
    color: '#e74c3c'
  },
  teamRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    padding: '4px',
    borderRadius: '4px'
  },
  teamName: {
    flexGrow: 1,
    paddingRight: '10px',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis'
  },
  select: {
    width: '100%',
    padding: '4px',
    fontSize: '12px',
    border: '1px solid #ddd',
    borderRadius: '3px'
  },
  scoreInput: {
    width: '40px',
    textAlign: 'center',
    border: '1px solid #ddd',
    borderRadius: '3px',
    padding: '4px',
    fontWeight: 'bold'
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    fontSize: '20px',
    color: '#666'
  }
};

export default PlayoffBracketEditor;