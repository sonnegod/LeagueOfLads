import { useParams } from 'react-router-dom';
import MatchDetails from '../components/MatchDetails';
import './MatchSeriesPages.css';

export default function MatchPage() {
  const { matchId } = useParams();
  return <div className="match-detail-page ui-page"><MatchDetails matchId={matchId} /></div>;
}
