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
import RequestPage from "./pages/RequestPage";
import SeriesPage from "./pages/SeriesPage";
import BettingPage from "./pages/BettingPage";
import HeadToHeadPage from "./pages/HeadToHeadPage";
import DraftGodPage from "./pages/DraftGod";
import LiveMatchesPage from "./pages/LiveMatchesPage";
import PrivacyPolicy from "./pages/PrivacyPolicy";

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
        <Route path="/h2h" element={<HeadToHeadPage />} />
        <Route path="/player" element={<PlayersPage />} />
        <Route path="/league" element={<LeaguesPage />} />
        <Route path="/league/:leagueId" element={<LeaguePage />} />
        <Route path="/match" element={<MatchesPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/hero" element={<HeroesPage />} />
        <Route path="/request" element={<RequestPage />} />
        <Route path="/series/:seriesId" element={<SeriesPage />} />
        <Route path="/betting" element={<BettingPage />} />
        <Route path="/draftgod" element={<DraftGodPage />} />
        <Route path="/live" element={<LiveMatchesPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      </Route>
    </Routes>
  );
}
