import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import PlayerPage from './pages/PlayerPage';
import HeroPage from './pages/HeroPage';
import HeroesPage from "./pages/HeroesPage";
import TeamPage from './pages/TeamPage';
import TeamsPage from './pages/TeamsPage';
import PlayersPage from './pages/PlayersPage';
import LeaguePage from './pages/LeaguePage';
import LeaguesPage from './pages/LeaguesPage';
import MatchPage from './pages/MatchPage';
import MatchesPage from './pages/MatchesPage';
import SearchPage from "./pages/SearchPage";
import RecentMatchesPage from "./pages/RecentMatchesPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/recentMatches" element={<RecentMatchesPage />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/player/:player_id" element={<PlayerPage />} />
        <Route path="/hero/:hero_id" element={<HeroPage />} />
        <Route path="/team/:teamId" element={<TeamPage />} />
        <Route path="/match/:matchId" element={<MatchPage />} />
        <Route path="/team" element={<TeamsPage />} />
        <Route path="/player" element={<PlayersPage />} />
        <Route path="/league" element={<LeaguesPage />} />
        <Route path="/league/:leagueId" element={<LeaguePage />} />
        <Route path="/match" element={<MatchesPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/hero" element={<HeroesPage />} />
      </Route>
    </Routes>
  );
}
