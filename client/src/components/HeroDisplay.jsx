import { Link } from 'react-router-dom';

export default function HeroDisplay({
  heroId,
  heroName,
  iconSize = 32,
  link = true,
  showName = true,
  style,
}) {
  const content = (
    <span style={{ ...containerStyle, ...style }}>
      {heroId && (
        <img
          src={`/heroes/icons/${heroId}.png`}
          alt=""
          loading="lazy"
          width={iconSize}
          height={iconSize}
          style={{ ...iconStyle, width: iconSize, height: iconSize }}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      )}
      {showName && <span>{heroName || `Hero ${heroId}`}</span>}
    </span>
  );

  if (!link || !heroId) return content;

  return (
    <Link to={`/hero/${heroId}`} style={linkStyle}>
      {content}
    </Link>
  );
}

const containerStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
};

const iconStyle = {
  flexShrink: 0,
  objectFit: 'cover',
  borderRadius: '4px',
  background: 'var(--surface, #121315)',
};

const linkStyle = {
  color: 'var(--primary, #646cff)',
  textDecoration: 'none',
};
