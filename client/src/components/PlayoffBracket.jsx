import React, { useEffect, useRef } from "react";
import * as d3 from "d3";

function sortBracketRounds(roundMap) {
  const rounds = Object.keys(roundMap)
    .map(Number)
    .sort((a, b) => a - b); // first -> last round

  for (let i = 1; i < rounds.length; i++) {
    const prevRound = roundMap[rounds[i - 1]];
    const currRound = roundMap[rounds[i]];


    if (!currRound || currRound.length <= 1) continue;

    // --- Conditional: upper teams dropping to lower bracket
    if (currRound.length === prevRound.length) {
      // 1-to-1 ordering: sort by winnerTo
      console.log(currRound,prevRound)
      prevRound.sort((a, b) => {
        const aSource = currRound.find(m => m.winnerTo === a.id).id;
        const bSource = currRound.find(m => m.winnerTo === b.id).id;
      
        return aSource - bSource;
      });
    } else {
      // Regular sorting by winnerTo mapping
      currRound.sort((a, b) => (a.winnerTo || 0) - (b.winnerTo || 0));
    }
  }

  return roundMap;
}


export default function DoubleElimBracket({ seriesList }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!seriesList || seriesList.length === 0) return;

    // --- Layout constants
    const styles = {
      margin: 30,
      matchHeight: 20,
      matchWidth: 160,
      matchGapX: 40,
      matchGapY: 40
    };
    styles.matchWidthAll = styles.matchWidth + styles.matchGapX;
    styles.matchHeightAll = styles.matchHeight + styles.matchGapY;

    // --- Separate upper/lower/bracket
    const upper = [];
    const lower = [];
    let grandFinal = null;
    const nodesMap = {};

    seriesList.forEach(s => {
      const node = { ...s, id: s.id };
      nodesMap[s.id] = node;
      if (s.Bracket === "U") upper.push(node);
      else if (s.Bracket === "L") lower.push(node);
      else if (s.Bracket === "GF") grandFinal = node;
    });

    // --- Group by round
    const groupByRound = nodes => {
      const map = {};
      nodes.forEach(n => {
        const r = n.Round || 0;
        if (!map[r]) map[r] = [];
        map[r].push(n);
      });
      return map;
    };

    let roundsUpper = groupByRound(upper);
    let roundsLower = groupByRound(lower);
    
    
    sortBracketRounds(roundsUpper);
    sortBracketRounds(roundsLower);

    // --- Compute positions (x proportional to round, y spaced evenly)
    const layoutBracket = (roundMap, maxRound, offsetY = 100) => {
        const roundKeys = Object.keys(roundMap).map(Number).sort((a, b) => b - a);
        // Store previous round’s matches for centering logic
        let prevMatches = null;

        roundKeys.forEach((round, roundIndex) => {
            const matches = roundMap[round];
            const x = ((maxRound - round) / (maxRound - 1)) * ((maxRound - 1) * styles.matchWidthAll);

            if (roundIndex === 0) {
            // FIRST ROUND: evenly spaced vertically
            const totalHeight = matches.length * styles.matchHeightAll - styles.matchGapY;
            const startY = offsetY + totalHeight / 2 - totalHeight;
            matches.forEach((m, i) => {
                m.x = x;
                m.y = startY + i * styles.matchHeightAll;
            });
            } else {
            const prev = prevMatches;

            if (matches.length < prev.length) {
                // COLLAPSING ROUND — center each match between its two feeders
                matches.forEach((m, i) => {
                const prev1 = prev[i * 2];
                const prev2 = prev[i * 2 + 1];
                const centerY = (prev1.y + prev2.y) / 2;
                m.x = x;
                m.y = centerY;
                });
            } else {
                // CARRYOVER ROUND — same number of matches, keep 1:1 vertical alignment
                matches.forEach((m, i) => {
                const prev1 = prev[i];
                m.x = x;
                m.y = prev1.y;
                });
            }
            }

            // Update for next iteration
            prevMatches = matches;
        });
    };

    const maxUpperRound = Math.max(...Object.keys(roundsUpper));
    const maxLowerRound = Math.max(...Object.keys(roundsLower));

    layoutBracket(roundsUpper, maxUpperRound); // normalize to lower bracket width
    const upperMaxY = Math.max(...upper.map(n => n.y)) + styles.matchHeightAll*8;
    layoutBracket(roundsLower, maxLowerRound, upperMaxY);

    // Grand final
    if (grandFinal) {
      grandFinal.x = Math.max(...upper.map(n => n.x), ...lower.map(n => n.x)) + styles.matchWidthAll;
      grandFinal.y = (Math.max(...lower.map(n => n.y))) / 2;
    }

    const nodes = [...upper, ...lower, grandFinal].filter(Boolean);

    // --- SVG rendering
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const width = Math.max(...nodes.map(n => n.x)) + styles.matchWidthAll + styles.margin * 2;
    const height = Math.max(...nodes.map(n => n.y)) + styles.matchHeightAll + styles.margin * 2;
    svg.attr("width", width).attr("height", height);

    const stage = svg.append("g").attr("transform", `translate(${styles.margin},${styles.margin})`);

    // --- Draw matches
    const matchGroup = stage
      .selectAll("g.match")
      .data(nodes)
      .join("g")
      .attr("class", "match")
      .attr("transform", d => `translate(${d.x},${d.y})`);

            // --- Background container
        matchGroup
        .append("rect")
        .attr("width", styles.matchWidth)
        .attr("height", styles.matchHeight * 2)
        .attr("rx", 6)
        .attr("fill", "white") // neutral background for border
        .attr("stroke", "#333")
        .attr("stroke-width", 1.5);

        // --- Team row backgrounds (shading per team)
        matchGroup
        .append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", styles.matchWidth)
        .attr("height", styles.matchHeight)
        .attr("fill", d => {
            if (!d.WinnerId) return "#dddddd"; // no result yet
            return d.WinnerId === d.Team1 ? "#c8facc" : "#ffcccc"; // green if won, red if lost
        });

        matchGroup
        .append("rect")
        .attr("x", 0)
        .attr("y", styles.matchHeight)
        .attr("width", styles.matchWidth)
        .attr("height", styles.matchHeight)
        .attr("fill", d => {
            if (!d.WinnerId) return "#dddddd";
            return d.WinnerId === d.Team2 ? "#c8facc" : "#ffcccc";
        });

        // --- Divider line
        matchGroup
        .append("line")
        .attr("x1", 0)
        .attr("y1", styles.matchHeight)
        .attr("x2", styles.matchWidth)
        .attr("y2", styles.matchHeight)
        .attr("stroke", "#333")
        .attr("stroke-width", 1);

        // --- Team 1 text
        matchGroup
        .append("text")
        .attr("x", styles.matchWidth / 2)
        .attr("y", styles.matchHeight / 2)
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle")
        .attr("font-size", 12)
        .text(d => d.Team1Name);

        // --- Team 2 text
        matchGroup
        .append("text")
        .attr("x", styles.matchWidth / 2)
        .attr("y", styles.matchHeight + styles.matchHeight / 2)
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle")
        .attr("font-size", 12)
        .text(d => d.Team2Name);

    // --- Draw winner links
    const line = d3.line().curve(d3.curveStep);
    const links = nodes.flatMap(n => {
      if (!n.winnerTo) return [];
      const target = nodes.find(t => t.id === n.winnerTo);
      return target ? [{ source: n, target }] : [];
    });

    stage
      .selectAll("path.link")
      .data(links)
      .join("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", "#757575ff")
      .attr("stroke-width", 2)
      .attr("d", d =>
        line([
          [d.source.x + styles.matchWidth, d.source.y + styles.matchHeight],
          [d.target.x, d.target.y + styles.matchHeight]
        ])
      );
  }, [seriesList]);

  return <svg ref={svgRef} style={{ background: "#f8f8f8" }} />;
}
