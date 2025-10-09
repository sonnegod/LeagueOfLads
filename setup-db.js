//setting up the sqlite database that will hold the dota information
import sqlite3 from "sqlite3";
import fs from "fs";

const db = new sqlite3.Database("./db/LadsData.db");


const playerContent = fs.readFileSync('./textFiles/PlayerInfo.txt', 'utf-8');
const leagueContent = fs.readFileSync('./textFiles/LeagueInfo.txt', 'utf-8');
//const teamContent = fs.readFileSync('TeamInfo.txt', 'utf-8');
//const teamPlayerContent = fs.readFileSync('TeamPlayer.txt', 'utf-8');


const playerRows = playerContent.split('\n');
const leagueRows = leagueContent.split('\n');
//const teamRows = teamContent.split('\n');
//const teamPlayerRows = teamPlayerContent.split('\n');


playerRows.forEach((row,index) => {

    if(row.trim() === '')
        return;

    const values = row.split(',');

    const playerId = values[0].trim();
    const playerName = values[1].trim();

    db.run('INSERT INTO PlayerInfo (PlayerId, PlayerName) VALUES (?,?)', [playerId,playerName], function(err) {
        if(err){
            console.log('Error inserting row for PlayerInfo:', err);
            console.log('PlayerName %s: ', playerName, 'Player Id %d: ', playerId)
        }
        else
            console.log('Inserted row into PlayerInfo with ID:', values);
    });
});

leagueRows.forEach((row,index) => {

    if(row.trim() === '')
        return;

    const values = row.split(',');

    const leagueId = values[0].trim();
    const leagueName = values[1].trim();

    db.run('INSERT INTO LeagueInfo (LeagueId, LeagueName) VALUES (?,?)', [leagueId,leagueName], function(err) {
        if(err){
            console.log('Error inserting row for LeagueInfo:', err);
            console.log('LeagueName %s: ', playerName, 'LeagueId %d: ', playerId)
        }
        else
            console.log('Inserted row into LeagueInfo with LeagueId:', values);
    });
});

/*
teamRows.forEach((row,index) => {

    if(row.trim() === '')
        return;

    const values = row.split(',');

    const teamId = values[0].trim();
    const teamName = values[1].trim();

    db.run('INSERT INTO TeamInfo (TeamId, TeamName) VALUES (?,?)', [teamId,teamName], function(err) {
        if(err){
            console.log('Error inserting row for TeamInfo:', err);
        }
        else
            console.log('Inserted row into TeamInfo with ID:', values);
    });
});


teamPlayerRows.forEach((row,index) => {

    if(row.trim() === '')
        return;

    const values = row.split(',');

    const teamId = values[0].trim();
    const player1 = values[1].trim();
    const player2 = values[2].trim();
    const player3 = values[3].trim();
    const player4 = values[4].trim();
    const player5 = values[5].trim();

    db.run('INSERT INTO Team (TeamId, Player1, Player2, Player3, Player4, Player5) VALUES (?,?,?,?,?,?)', [teamId,player1,player2,player3,player4,player5], function(err) {
        if(err){
            console.log('Error inserting row for Team:', err);
        }
        else
            console.log('Inserted row into Team with rows:', values);
    });

});
*/

db.close;