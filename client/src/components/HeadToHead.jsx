import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Select from 'react-select'; // Ensure this is installed: npm install react-select
import { Trophy, Swords, Crosshair, Coins, User } from 'lucide-react';

const HeadToHead = () => {
  const [players, setPlayers] = useState([]);
  const [p1Id, setP1Id] = useState('');
  const [p2Id, setP2Id] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/players')
      .then(res => res.json())
      .then(data => {
        const sortedPlayers = [...data].sort((a, b) => {
          const nameA = a?.PlayerName ? String(a.PlayerName) : "";
          const nameB = b?.PlayerName ? String(b.PlayerName) : "";
          return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
        });
        
        setPlayers(sortedPlayers);
        if(data.length > 1) {
          const index1 = Math.floor(Math.random() * data.length);
          let index2 = Math.floor(Math.random() * data.length);
          while (index2 === index1) {
            index2 = Math.floor(Math.random() * data.length);
          }
          setP1Id(data[index1].PlayerId);
          setP2Id(data[index2].PlayerId);
        }
      });
  }, []);

  useEffect(() => {
    if (!p1Id || !p2Id) return;    
    setLoading(true);
    fetch(`/api/h2h/${p1Id}/${p2Id}`)
      .then(res => res.json())
      .then(result => {
        setData(result);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [p1Id, p2Id]);

  if (!data && loading) return <div className="text-center p-10">Loading Stats...</div>;
  if (!data) return null;

  return (
    <div className="w-full">
      {/* SELECTION BAR */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-slate-900 p-6 rounded-xl shadow-lg mb-8 border border-slate-800 gap-4">
        <PlayerSelect value={p1Id} onChange={setP1Id} players={players} label="Player 1 (Blue)" />
        <div className="text-4xl font-black text-slate-700 italic px-4">VS</div>
        <PlayerSelect value={p2Id} onChange={setP2Id} players={players} label="Player 2 (Red)" align="right" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <PlayerCard stats={data.p1} color="blue" />
        <div className="flex flex-col gap-6">
          <div className="bg-slate-900 rounded-xl p-6 text-center border border-slate-800 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-red-500"></div>
            <h3 className="text-slate-500 uppercase text-xs font-bold tracking-widest mb-2">Head to Head Record</h3>
            <div className="flex justify-center items-center gap-6 text-5xl font-black">
              <span className="text-blue-500">{data.history.p1Wins}</span>
              <span className="text-slate-700 text-3xl">-</span>
              <span className="text-red-500">{data.history.p2Wins}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">Total Games: {data.history.matches.length}</p>
          </div>
          <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
            <ComparisonRow label="Win Rate %" val1={data.p1.winrate} val2={data.p2.winrate} />
            <ComparisonRow label="KDA Ratio" val1={data.p1.kda} val2={data.p2.kda} />
            <ComparisonRow label="GPM" val1={data.p1.gpm} val2={data.p2.gpm} max={1000} />
            <ComparisonRow label="CS Avg" val1={data.p1.cs} val2={data.p2.cs} max={500} />
          </div>
        </div>
        <PlayerCard stats={data.p2} color="red" />
      </div>

      <div className="mt-8 bg-slate-900 rounded-xl p-6 border border-slate-800">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-200">
          <Swords className="text-yellow-500" /> Match History
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-slate-950 uppercase text-xs font-bold text-slate-500">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">MatchId</th>
                <th className="p-3">Teams</th>
                <th className="p-3 text-center">Winner</th>
                <th className="p-3 text-right">KDA ({data.p1.name})</th>
                <th className="p-3 text-right">KDA ({data.p2.name})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.history.matches.map((m, i) => (
                <tr key={i} className="hover:bg-slate-800/50 transition">
                  <td className="p-3">{new Date(m.DateCreated).toLocaleDateString()}</td>
                  <td className="p-3"><Link to={`/match/${m.MatchId}`}>{m.MatchId}</Link></td>
                  <td className="p-3 text-white">
                    <span className="text-blue-400">{m.P1Team}</span> vs <span className="text-red-400">{m.P2Team}</span>
                  </td>
                  <td className={`p-3 text-center font-bold ${m.P1Won ? 'text-blue-500' : 'text-red-500'}`}>
                    {m.P1Won ? data.p1.name : data.p2.name}
                  </td>
                  <td className="p-3 text-right font-mono">{m.P1KDA}</td>
                  <td className="p-3 text-right font-mono">{m.P2KDA}</td>
                </tr>
              ))}
              {data.history.matches.length === 0 && (
                <tr><td colSpan="6" className="p-8 text-center italic opacity-50">No direct matches found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- SEARCHABLE SUB-COMPONENT ---

const PlayerSelect = ({ value, onChange, players, label, align = "left" }) => {
  // Convert players into the { value, label } format required by react-select
  const options = players.map(p => ({
    value: p.PlayerId,
    label: p.PlayerName
  }));

  // Find the current selection object
  const selectedOption = options.find(opt => opt.value === value) || null;

  // Custom styling to match your Slate-950 / Tailwind theme
  const customStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: '#020617', // slate-950
      borderColor: state.isFocused ? '#3b82f6' : '#334155', // blue-500 or slate-700
      boxShadow: state.isFocused ? '0 0 0 2px rgba(59, 130, 246, 0.5)' : 'none',
      padding: '4px',
      '&:hover': {
        borderColor: '#475569', // slate-600
      },
    }),
    singleValue: (base) => ({
      ...base,
      color: 'white',
      fontWeight: 'bold',
      fontSize: '1.125rem', // text-lg
      textAlign: align === 'right' ? 'right' : 'left',
    }),
    placeholder: (base) => ({
      ...base,
      color: '#64748b', // slate-500
    }),
    input: (base) => ({
      ...base,
      color: 'white',
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: '#020617', // slate-950
      border: '1px solid #334155', // slate-700
      zIndex: 50,
    }),
    option: (base, { isFocused, isSelected }) => ({
      ...base,
      backgroundColor: isSelected ? '#3b82f6' : isFocused ? '#1e293b' : 'transparent',
      color: 'white',
      cursor: 'pointer',
      fontWeight: isSelected ? 'bold' : 'normal',
      '&:active': {
        backgroundColor: '#3b82f6',
      },
    }),
  };

  return (
    <div className={`w-full md:w-1/3 ${align === 'right' ? 'text-right' : ''}`}>
      <label className="text-slate-500 text-xs uppercase font-bold tracking-wider block mb-2">{label}</label>
      <Select
        options={options}
        value={selectedOption}
        onChange={(opt) => onChange(opt ? opt.value : '')}
        isSearchable={true}
        styles={customStyles}
        placeholder="Search..."
        classNamePrefix="react-select"
      />
    </div>
  );
};

// --- OTHER STAT DISPLAY COMPONENTS ---

const PlayerCard = ({ stats, color }) => {
  const isBlue = color === 'blue';
  const accent = isBlue ? 'text-blue-400' : 'text-red-400';
  const border = isBlue ? 'border-blue-500' : 'border-red-500';

  return (
    <div className={`bg-slate-900 rounded-2xl p-6 border-t-4 ${border} shadow-xl`}>
      <div className="text-center mb-6">
        <div className={`w-20 h-20 bg-slate-800 rounded-full mx-auto mb-4 border-2 ${border} flex items-center justify-center text-3xl font-bold text-white`}>
          <User />
        </div>
        <h2 className={`text-2xl font-bold ${accent}`}>{stats.name}</h2>
        <div className="flex gap-1 justify-center mt-3">
          {stats.recent.map((res, i) => (
            <span key={i} className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-white ${res === 'W' ? 'bg-green-600' : 'bg-red-600'}`}>
              {res}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <StatBox label="Win Rate" value={`${stats.winrate}%`} icon={<Trophy size={14} />} color={accent} />
        <StatBox label="KDA Ratio" value={stats.kda} icon={<Crosshair size={14} />} color={accent} />
        <StatBox label="Avg GPM" value={stats.gpm} icon={<Coins size={14} />} color={accent} />
      </div>
    </div>
  );
};

const StatBox = ({ label, value, icon, color }) => (
  <div className="bg-slate-950/50 p-3 rounded-lg flex justify-between items-center border border-slate-800">
    <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
      {icon} {label}
    </div>
    <div className={`text-lg font-bold ${color}`}>{value}</div>
  </div>
);

const ComparisonRow = ({ label, val1, val2, max }) => {
  const v1 = parseFloat(val1);
  const v2 = parseFloat(val2);
  const total = max || (v1 + v2);
  const p1Width = total === 0 ? 0 : Math.min(100, (v1 / total) * 100);
  const p2Width = total === 0 ? 0 : Math.min(100, (v2 / total) * 100);
  const isP1Better = v1 >= v2;

  return (
    <div className="mb-5 last:mb-0">
      <div className="flex justify-between text-xs font-bold mb-1">
        <span className={isP1Better ? "text-blue-400" : "text-slate-600"}>{val1}</span>
        <span className="text-slate-500 uppercase tracking-wider text-[10px]">{label}</span>
        <span className={!isP1Better ? "text-red-400" : "text-slate-600"}>{val2}</span>
      </div>
      <div className="flex h-2 bg-slate-950 rounded-full overflow-hidden">
        <div className="flex-1 flex justify-end">
          <div style={{ width: max ? `${(v1/max)*50}%` : `${(v1/(v1+v2))*100}%` }} className={`h-full rounded-l-full ${isP1Better ? 'bg-blue-500' : 'bg-blue-900/30'}`}></div>
        </div>
        <div className="w-0.5 bg-slate-800"></div>
        <div className="flex-1 flex justify-start">
          <div style={{ width: max ? `${(v2/max)*50}%` : `${(v2/(v1+v2))*100}%` }} className={`h-full rounded-r-full ${!isP1Better ? 'bg-red-500' : 'bg-red-900/30'}`}></div>
        </div>
      </div>
    </div>
  );
};

export default HeadToHead;