import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Layout from './components/Layout';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import SiteManagement from './pages/SiteManagement';
import PlayerPage from './pages/PlayerPage';
import HeroPage from './pages/HeroPage';
import HeroesPage from "./pages/HeroesPage";
import AwardsPage from './pages/AwardsPage';
import TeamPage from './pages/TeamPage';
import TeamsPage from './pages/TeamsPage';
import PlayersPage from './pages/PlayersPage';
import LeaguePage from './pages/LeaguePage';
import LeaguesPage from './pages/LeaguesPage';
import MatchPage from './pages/MatchPage';
import MatchesPage from './pages/MatchesPage';
import SearchPage from "./pages/SearchPage";
import RecentsPage from "./pages/RecentsPage";
import RequestPage from "./pages/RequestPage";
import SeriesPage from "./pages/SeriesPage";
import BettingPage from "./pages/BettingPage";
import BettingFixturePage from './pages/BettingFixturePage';
import {SeasonBettingLayout} from './context/SeasonBetSlipContext';
import HeadToHeadPage from "./pages/HeadToHeadPage";
const DraftGodPage = lazy(() => import('./pages/DraftGod'));
const SkillBuildPreview = import.meta.env.DEV ? lazy(() => import('./pages/SkillBuildPreview')) : null;
import LiveMatchesPage from "./pages/LiveMatchesPage";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import RulesPage from "./pages/RulesPage";
import SignupPage from "./pages/SignupPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/recents" element={<RecentsPage />} />
        <Route path="/recentMatches" element={<RecentsPage />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/site-management" element={<SiteManagement />} />
        <Route path="/player/:player_id" element={<PlayerPage />} />
        <Route path="/hero/:hero_id" element={<HeroPage />} />
        <Route path="/team/:teamId" element={<TeamPage />} />
        <Route path="/team/roster/:teamSubmissionId" element={<TeamPage />} />
        <Route path="/match/:matchId" element={<MatchPage />} />
        {import.meta.env.DEV && <Route path="/preview/skill-build" element={<Suspense fallback={<p>Loading preview…</p>}><SkillBuildPreview /></Suspense>} />}
        <Route path="/team" element={<TeamsPage />} />
        <Route path="/h2h" element={<HeadToHeadPage />} />
        <Route path="/player" element={<PlayersPage />} />
        <Route path="/league" element={<LeaguesPage />} />
        <Route path="/league/:leagueId" element={<LeaguePage />} />
        <Route path="/match" element={<MatchesPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/hero" element={<HeroesPage />} />
        <Route path="/awards" element={<AwardsPage />} />
        <Route path="/request" element={<RequestPage />} />
        <Route path="/series/:seriesId" element={<SeriesPage />} />
        <Route element={<SeasonBettingLayout />}>
          <Route path="/betting" element={<BettingPage />} />
          <Route path="/bet/matchup/:eventId" element={<BettingFixturePage />} />
        </Route>
        <Route path="/draftgod" element={<Suspense fallback={<p>Loading Draft God…</p>}><DraftGodPage /></Suspense>} />
        <Route path="/live" element={<LiveMatchesPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/signup/:seasonId" element={<SignupPage />} />
      </Route>
    </Routes>
  );
}
