(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseGetter = void 0;
const helpers = require("../helpers");
class BaseGetter {
    /**
     * Creates an instance of a Storage getter.
     *
     * @param storage The implementation of Storage.
     */
    constructor(storage) {
        this.storage = storage;
    }
    /**
     * Gets all the rounds that contain ordered participants.
     *
     * @param stage The stage to get rounds from.
     */
    async getOrderedRounds(stage) {
        if (!(stage === null || stage === void 0 ? void 0 : stage.settings.size))
            throw Error('The stage has no size.');
        if (stage.type === 'single_elimination')
            return this.getOrderedRoundsSingleElimination(stage.id);
        return this.getOrderedRoundsDoubleElimination(stage.id);
    }
    /**
     * Gets all the rounds that contain ordered participants in a single elimination stage.
     *
     * @param stageId ID of the stage.
     */
    async getOrderedRoundsSingleElimination(stageId) {
        return [await this.getUpperBracketFirstRound(stageId)];
    }
    /**
     * Gets all the rounds that contain ordered participants in a double elimination stage.
     *
     * @param stageId ID of the stage.
     */
    async getOrderedRoundsDoubleElimination(stageId) {
        // Getting all rounds instead of cherry-picking them is the least expensive.
        const rounds = await this.storage.select('round', { stage_id: stageId });
        if (!rounds)
            throw Error('Error getting rounds.');
        const loserBracket = await this.getLoserBracket(stageId);
        if (!loserBracket)
            throw Error('Loser bracket not found.');
        const firstRoundWB = rounds[0];
        const roundsLB = rounds.filter(r => r.group_id === loserBracket.id);
        const orderedRoundsLB = roundsLB.filter(r => helpers.isOrderingSupportedLoserBracket(r.number, roundsLB.length));
        return [firstRoundWB, ...orderedRoundsLB];
    }
    /**
     * Gets the positional information (number in group and total number of rounds in group) of a round based on its id.
     *
     * @param roundId ID of the round.
     */
    async getRoundPositionalInfo(roundId) {
        const round = await this.storage.select('round', roundId);
        if (!round)
            throw Error('Round not found.');
        const rounds = await this.storage.select('round', { group_id: round.group_id });
        if (!rounds)
            throw Error('Error getting rounds.');
        return {
            roundNumber: round.number,
            roundCount: rounds.length,
        };
    }
    /**
     * Gets the matches leading to the given match.
     *
     * @param match The current match.
     * @param matchLocation Location of the current match.
     * @param stage The parent stage.
     * @param roundNumber Number of the round.
     */
    async getPreviousMatches(match, matchLocation, stage, roundNumber) {
        if (matchLocation === 'loser_bracket')
            return this.getPreviousMatchesLB(match, stage, roundNumber);
        if (matchLocation === 'final_group')
            return this.getPreviousMatchesFinal(match, stage, roundNumber);
        if (roundNumber === 1)
            return []; // The match is in the first round of an upper bracket.
        return this.getMatchesBeforeMajorRound(match, roundNumber);
    }
    /**
     * Gets the matches leading to the given match, which is in a final group (consolation final or grand final).
     *
     * @param match The current match.
     * @param stage The parent stage.
     * @param roundNumber Number of the current round.
     */
    async getPreviousMatchesFinal(match, stage, roundNumber) {
        if (stage.type === 'single_elimination')
            return this.getPreviousMatchesFinalSingleElimination(match, stage);
        return this.getPreviousMatchesFinalDoubleElimination(match, roundNumber);
    }
    /**
     * Gets the matches leading to the given match, which is in a final group (consolation final).
     *
     * @param match The current match.
     * @param stage The parent stage.
     */
    async getPreviousMatchesFinalSingleElimination(match, stage) {
        const upperBracket = await this.getUpperBracket(match.stage_id);
        const upperBracketRoundCount = helpers.getUpperBracketRoundCount(stage.settings.size);
        const semiFinalsRound = await this.storage.selectFirst('round', {
            group_id: upperBracket.id,
            number: upperBracketRoundCount - 1, // Second to last round
        });
        if (!semiFinalsRound)
            throw Error('Semi finals round not found.');
        const semiFinalMatches = await this.storage.select('match', {
            round_id: semiFinalsRound.id,
        });
        if (!semiFinalMatches)
            throw Error('Error getting semi final matches.');
        // In single elimination, both the final and consolation final have the same previous matches.
        return semiFinalMatches;
    }
    /**
     * Gets the matches leading to the given match, which is in a final group (grand final).
     *
     * @param match The current match.
     * @param stage The parent stage.
     * @param roundNumber Number of the current round.
     */
    async getPreviousMatchesFinalDoubleElimination(match, roundNumber) {
        if (roundNumber > 1) // Double grand final
            return [await this.findMatch(match.group_id, roundNumber - 1, 1)];
        const winnerBracket = await this.getUpperBracket(match.stage_id);
        const lastRoundWB = await this.getLastRound(winnerBracket.id);
        const winnerBracketFinalMatch = await this.storage.selectFirst('match', {
            round_id: lastRoundWB.id,
            number: 1,
        });
        if (!winnerBracketFinalMatch)
            throw Error('Match not found.');
        const loserBracket = await this.getLoserBracket(match.stage_id);
        if (!loserBracket)
            throw Error('Loser bracket not found.');
        const lastRoundLB = await this.getLastRound(loserBracket.id);
        const loserBracketFinalMatch = await this.storage.selectFirst('match', {
            round_id: lastRoundLB.id,
            number: 1,
        });
        if (!loserBracketFinalMatch)
            throw Error('Match not found.');
        return [winnerBracketFinalMatch, loserBracketFinalMatch];
    }
    /**
     * Gets the matches leading to a given match from the loser bracket.
     *
     * @param match The current match.
     * @param stage The parent stage.
     * @param roundNumber Number of the round.
     */
    async getPreviousMatchesLB(match, stage, roundNumber) {
        if (stage.settings.skipFirstRound && roundNumber === 1)
            return [];
        if (helpers.hasBye(match))
            return []; // Shortcut because we are coming from propagateByes().
        const winnerBracket = await this.getUpperBracket(match.stage_id);
        const actualRoundNumberWB = Math.ceil((roundNumber + 1) / 2);
        const roundNumberWB = stage.settings.skipFirstRound ? actualRoundNumberWB - 1 : actualRoundNumberWB;
        if (roundNumber === 1)
            return this.getMatchesBeforeFirstRoundLB(match, winnerBracket.id, roundNumberWB);
        if (helpers.isMajorRound(roundNumber))
            return this.getMatchesBeforeMajorRound(match, roundNumber);
        return this.getMatchesBeforeMinorRoundLB(match, winnerBracket.id, roundNumber, roundNumberWB);
    }
    /**
     * Gets the matches leading to a given match in a major round (every round of upper bracket or specific ones in lower bracket).
     *
     * @param match The current match.
     * @param roundNumber Number of the round.
     */
    async getMatchesBeforeMajorRound(match, roundNumber) {
        return [
            await this.findMatch(match.group_id, roundNumber - 1, match.number * 2 - 1),
            await this.findMatch(match.group_id, roundNumber - 1, match.number * 2),
        ];
    }
    /**
     * Gets the matches leading to a given match in the first round of the loser bracket.
     *
     * @param match The current match.
     * @param winnerBracketId ID of the winner bracket.
     * @param roundNumberWB The number of the previous round in the winner bracket.
     */
    async getMatchesBeforeFirstRoundLB(match, winnerBracketId, roundNumberWB) {
        return [
            await this.findMatch(winnerBracketId, roundNumberWB, helpers.getOriginPosition(match, 'opponent1')),
            await this.findMatch(winnerBracketId, roundNumberWB, helpers.getOriginPosition(match, 'opponent2')),
        ];
    }
    /**
     * Gets the matches leading to a given match in a minor round of the loser bracket.
     *
     * @param match The current match.
     * @param winnerBracketId ID of the winner bracket.
     * @param roundNumber Number of the current round.
     * @param roundNumberWB The number of the previous round in the winner bracket.
     */
    async getMatchesBeforeMinorRoundLB(match, winnerBracketId, roundNumber, roundNumberWB) {
        const matchNumber = helpers.getOriginPosition(match, 'opponent1');
        return [
            await this.findMatch(winnerBracketId, roundNumberWB, matchNumber),
            await this.findMatch(match.group_id, roundNumber - 1, match.number),
        ];
    }
    /**
     * Gets the match(es) where the opponents of the current match will go just after.
     *
     * @param match The current match.
     * @param matchLocation Location of the current match.
     * @param stage The parent stage.
     * @param roundNumber The number of the current round.
     * @param roundCount Count of rounds.
     */
    async getNextMatches(match, matchLocation, stage, roundNumber, roundCount) {
        switch (matchLocation) {
            case 'single_bracket':
                return this.getNextMatchesUpperBracket(match, stage, roundNumber, roundCount);
            case 'winner_bracket':
                return this.getNextMatchesWB(match, stage, roundNumber, roundCount);
            case 'loser_bracket':
                return this.getNextMatchesLB(match, stage, roundNumber, roundCount);
            case 'final_group':
                return this.getNextMatchesFinal(match, stage, roundNumber, roundCount);
            default:
                throw Error('Unknown bracket kind.');
        }
    }
    /**
     * Gets the match(es) where the opponents of the current match of winner bracket will go just after.
     *
     * @param match The current match.
     * @param stage The parent stage.
     * @param roundNumber The number of the current round.
     * @param roundCount Count of rounds.
     */
    async getNextMatchesWB(match, stage, roundNumber, roundCount) {
        const loserBracket = await this.getLoserBracket(match.stage_id);
        if (loserBracket === null) // Only one match in the stage, there is no loser bracket.
            return [];
        const actualRoundNumber = stage.settings.skipFirstRound ? roundNumber + 1 : roundNumber;
        const roundNumberLB = actualRoundNumber > 1 ? (actualRoundNumber - 1) * 2 : 1;
        const participantCount = stage.settings.size;
        const method = helpers.getLoserOrdering(stage.settings.seedOrdering, roundNumberLB);
        const actualMatchNumberLB = helpers.findLoserMatchNumber(participantCount, roundNumberLB, match.number, method);
        return [
            ...await this.getNextMatchesUpperBracket(match, stage, roundNumber, roundCount),
            await this.findMatch(loserBracket.id, roundNumberLB, actualMatchNumberLB),
        ];
    }
    /**
     * Gets the match(es) where the opponents of the current match of an upper bracket will go just after.
     *
     * @param match The current match.
     * @param stage The parent stage.
     * @param roundNumber The number of the current round.
     * @param roundCount Count of rounds.
     */
    async getNextMatchesUpperBracket(match, stage, roundNumber, roundCount) {
        if (stage.type === 'single_elimination')
            return this.getNextMatchesUpperBracketSingleElimination(match, stage.type, roundNumber, roundCount);
        return this.getNextMatchesUpperBracketDoubleElimination(match, stage.type, roundNumber, roundCount);
    }
    /**
     * Gets the match(es) where the opponents of the current match of the unique bracket of a single elimination will go just after.
     *
     * @param match The current match.
     * @param stageType Type of the stage.
     * @param roundNumber The number of the current round.
     * @param roundCount Count of rounds.
     */
    async getNextMatchesUpperBracketSingleElimination(match, stageType, roundNumber, roundCount) {
        if (roundNumber === roundCount - 1) {
            const finalGroupId = await this.getFinalGroupId(match.stage_id, stageType);
            const consolationFinal = await this.getFinalGroupFirstMatch(finalGroupId);
            return [
                await this.getDiagonalMatch(match.group_id, roundNumber, match.number),
                ...consolationFinal ? [consolationFinal] : [],
            ];
        }
        if (roundNumber === roundCount)
            return [];
        return [await this.getDiagonalMatch(match.group_id, roundNumber, match.number)];
    }
    /**
     * Gets the match(es) where the opponents of the current match of the unique bracket of a double elimination will go just after.
     *
     * @param match The current match.
     * @param stageType Type of the stage.
     * @param roundNumber The number of the current round.
     * @param roundCount Count of rounds.
     */
    async getNextMatchesUpperBracketDoubleElimination(match, stageType, roundNumber, roundCount) {
        if (roundNumber === roundCount) {
            const finalGroupId = await this.getFinalGroupId(match.stage_id, stageType);
            return [await this.getFinalGroupFirstMatch(finalGroupId)];
        }
        return [await this.getDiagonalMatch(match.group_id, roundNumber, match.number)];
    }
    /**
     * Gets the match(es) where the opponents of the current match of loser bracket will go just after.
     *
     * @param match The current match.
     * @param stage The parent stage.
     * @param roundNumber The number of the current round.
     * @param roundCount Count of rounds.
     */
    async getNextMatchesLB(match, stage, roundNumber, roundCount) {
        if (roundNumber === roundCount - 1) {
            const finalGroupId = await this.getFinalGroupId(match.stage_id, stage.type);
            const consolationFinal = await this.getConsolationFinalMatchDoubleElimination(finalGroupId);
            return [
                ...await this.getMatchAfterMajorRoundLB(match, roundNumber),
                ...consolationFinal ? [consolationFinal] : [], // Loser goes in consolation.
            ];
        }
        if (roundNumber === roundCount) {
            const finalGroupId = await this.getFinalGroupId(match.stage_id, stage.type);
            const grandFinal = await this.getFinalGroupFirstMatch(finalGroupId);
            const consolationFinal = await this.getConsolationFinalMatchDoubleElimination(finalGroupId);
            return [
                grandFinal,
                ...consolationFinal ? [consolationFinal] : [], // Returned array is length 1 if no consolation final.
            ];
        }
        if (helpers.isMajorRound(roundNumber))
            return this.getMatchAfterMajorRoundLB(match, roundNumber);
        return this.getMatchAfterMinorRoundLB(match, roundNumber);
    }
    /**
     * Gets the first match of the final group (consolation final or grand final).
     *
     * @param finalGroupId ID of the final group.
     */
    async getFinalGroupFirstMatch(finalGroupId) {
        if (finalGroupId === null)
            return null; // `null` is required for `getNextMatchesWB()` because of how `applyToNextMatches()` works.
        return this.findMatch(finalGroupId, 1, 1);
    }
    /**
     * Gets the consolation final in a double elimination tournament.
     *
     * @param finalGroupId ID of the final group.
     */
    async getConsolationFinalMatchDoubleElimination(finalGroupId) {
        if (finalGroupId === null)
            return null;
        return this.storage.selectFirst('match', {
            group_id: finalGroupId,
            number: 2, // Used to differentiate grand final and consolation final matches in the same final group.
        });
    }
    /**
     * Gets the match following the current match, which is in the final group (consolation final or grand final).
     *
     * @param match The current match.
     * @param stage The parent stage.
     * @param roundNumber The number of the current round.
     * @param roundCount The count of rounds.
     */
    async getNextMatchesFinal(match, stage, roundNumber, roundCount) {
        if (roundNumber === roundCount)
            return [];
        if (stage.settings.consolationFinal && match.number === 1 && roundNumber === roundCount - 1)
            return []; // Current match is the last grand final match.
        return [await this.findMatch(match.group_id, roundNumber + 1, 1)];
    }
    /**
     * Gets the match where the opponents of the current match of a winner bracket's major round will go just after.
     *
     * @param match The current match.
     * @param roundNumber The number of the current round.
     */
    async getMatchAfterMajorRoundLB(match, roundNumber) {
        return [await this.getParallelMatch(match.group_id, roundNumber, match.number)];
    }
    /**
     * Gets the match where the opponents of the current match of a winner bracket's minor round will go just after.
     *
     * @param match The current match.
     * @param roundNumber The number of the current round.
     */
    async getMatchAfterMinorRoundLB(match, roundNumber) {
        return [await this.getDiagonalMatch(match.group_id, roundNumber, match.number)];
    }
    /**
     * Returns the good seeding ordering based on the stage's type.
     *
     * @param stageType The type of the stage.
     * @param create A reference to a Create instance.
     */
    static getSeedingOrdering(stageType, create) {
        return stageType === 'round_robin' ? create.getRoundRobinOrdering() : create.getStandardBracketFirstRoundOrdering();
    }
    /**
     * Returns the matches which contain the seeding of a stage based on its type.
     *
     * @param stageId ID of the stage.
     * @param stageType The type of the stage.
     */
    async getSeedingMatches(stageId, stageType) {
        if (stageType === 'round_robin')
            return this.storage.select('match', { stage_id: stageId });
        try {
            const firstRound = await this.getUpperBracketFirstRound(stageId);
            return this.storage.select('match', { round_id: firstRound.id });
        }
        catch {
            return []; // The stage may have not been created yet.
        }
    }
    /**
     * Gets the first round of the upper bracket.
     *
     * @param stageId ID of the stage.
     */
    async getUpperBracketFirstRound(stageId) {
        // Considering the database is ordered, this round will always be the first round of the upper bracket.
        const firstRound = await this.storage.selectFirst('round', { stage_id: stageId, number: 1 }, false);
        if (!firstRound)
            throw Error('Round not found.');
        return firstRound;
    }
    /**
     * Gets the last round of a group.
     *
     * @param groupId ID of the group.
     */
    async getLastRound(groupId) {
        const round = await this.storage.selectLast('round', { group_id: groupId }, false);
        if (!round)
            throw Error('Error getting rounds.');
        return round;
    }
    /**
     * Returns the id of the final group (containing consolation final, or grand final, or both).
     *
     * @param stageId ID of the stage.
     * @param stageType Type of the stage.
     */
    async getFinalGroupId(stageId, stageType) {
        const groupNumber = stageType === 'single_elimination' ? 2 /* single bracket + final */ : 3 /* winner bracket + loser bracket + final */;
        const finalGroup = await this.storage.selectFirst('group', { stage_id: stageId, number: groupNumber });
        if (!finalGroup)
            return null;
        return finalGroup.id;
    }
    /**
     * Gets the upper bracket (the only bracket if single elimination or the winner bracket in double elimination).
     *
     * @param stageId ID of the stage.
     */
    async getUpperBracket(stageId) {
        const winnerBracket = await this.storage.selectFirst('group', { stage_id: stageId, number: 1 });
        if (!winnerBracket)
            throw Error('Winner bracket not found.');
        return winnerBracket;
    }
    /**
     * Gets the loser bracket.
     *
     * @param stageId ID of the stage.
     */
    async getLoserBracket(stageId) {
        return this.storage.selectFirst('group', { stage_id: stageId, number: 2 });
    }
    /**
     * Gets the corresponding match in the next round ("diagonal match") the usual way.
     *
     * Just like from Round 1 to Round 2 in a single elimination stage.
     *
     * @param groupId ID of the group.
     * @param roundNumber Number of the round in its parent group.
     * @param matchNumber Number of the match in its parent round.
     */
    async getDiagonalMatch(groupId, roundNumber, matchNumber) {
        return this.findMatch(groupId, roundNumber + 1, helpers.getDiagonalMatchNumber(matchNumber));
    }
    /**
     * Gets the corresponding match in the next round ("parallel match") the "major round to minor round" way.
     *
     * Just like from Round 1 to Round 2 in the loser bracket of a double elimination stage.
     *
     * @param groupId ID of the group.
     * @param roundNumber Number of the round in its parent group.
     * @param matchNumber Number of the match in its parent round.
     */
    async getParallelMatch(groupId, roundNumber, matchNumber) {
        return this.findMatch(groupId, roundNumber + 1, matchNumber);
    }
    /**
     * Finds a match in a given group. The match must have the given number in a round of which the number in group is given.
     *
     * **Example:** In group of id 1, give me the 4th match in the 3rd round.
     *
     * @param groupId ID of the group.
     * @param roundNumber Number of the round in its parent group.
     * @param matchNumber Number of the match in its parent round.
     */
    async findMatch(groupId, roundNumber, matchNumber) {
        const round = await this.storage.selectFirst('round', {
            group_id: groupId,
            number: roundNumber,
        });
        if (!round)
            throw Error('Round not found.');
        const match = await this.storage.selectFirst('match', {
            round_id: round.id,
            number: matchNumber,
        });
        if (!match)
            throw Error('Match not found.');
        return match;
    }
    /**
     * Finds a match game based on its `id` or based on the combination of its `parent_id` and `number`.
     *
     * @param game Values to change in a match game.
     */
    async findMatchGame(game) {
        if (game.id !== undefined) {
            const stored = await this.storage.select('match_game', game.id);
            if (!stored)
                throw Error('Match game not found.');
            return stored;
        }
        if (game.parent_id !== undefined && game.number) {
            const stored = await this.storage.selectFirst('match_game', {
                parent_id: game.parent_id,
                number: game.number,
            });
            if (!stored)
                throw Error('Match game not found.');
            return stored;
        }
        throw Error('No match game id nor parent id and number given.');
    }
}
exports.BaseGetter = BaseGetter;

},{"../helpers":8}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StageCreator = exports.create = void 0;
const ordering_1 = require("../../ordering");
const helpers = require("../../helpers");
/**
 * Creates a stage.
 *
 * @param this Instance of BracketsManager.
 * @param stage The stage to create.
 */
async function create(stage) {
    const creator = new StageCreator(this.storage, stage);
    return creator.run();
}
exports.create = create;
class StageCreator {
    /**
     * Creates an instance of StageCreator, which will handle the creation of the stage.
     *
     * @param storage The implementation of Storage.
     * @param stage The stage to create.
     */
    constructor(storage, stage) {
        this.storage = storage;
        this.stage = stage;
        this.stage.settings = this.stage.settings || {};
        this.seedOrdering = [...this.stage.settings.seedOrdering || []];
        this.updateMode = false;
        this.enableByesInUpdate = false;
        if (!this.stage.name)
            throw Error('You must provide a name for the stage.');
        if (this.stage.tournamentId === undefined)
            throw Error('You must provide a tournament id for the stage.');
        if (stage.type === 'round_robin')
            this.stage.settings.roundRobinMode = this.stage.settings.roundRobinMode || 'simple';
        if (stage.type === 'single_elimination')
            this.stage.settings.consolationFinal = this.stage.settings.consolationFinal || false;
        if (stage.type === 'double_elimination')
            this.stage.settings.grandFinal = this.stage.settings.grandFinal || 'none';
        this.stage.settings.matchesChildCount = this.stage.settings.matchesChildCount || 0;
    }
    /**
     * Run the creation process.
     */
    async run() {
        let stage;
        switch (this.stage.type) {
            case 'round_robin':
                stage = await this.roundRobin();
                break;
            case 'single_elimination':
                stage = await this.singleElimination();
                break;
            case 'double_elimination':
                stage = await this.doubleElimination();
                break;
            default:
                throw Error('Unknown stage type.');
        }
        if (stage.id === -1)
            throw Error('Something went wrong when creating the stage.');
        await this.ensureSeedOrdering(stage.id);
        return stage;
    }
    /**
     * Enables the update mode.
     *
     * @param stageId ID of the stage.
     * @param enableByes Whether to use BYEs or TBDs for `null` values in an input seeding.
     */
    setExisting(stageId, enableByes) {
        this.updateMode = true;
        this.currentStageId = stageId;
        this.enableByesInUpdate = enableByes;
    }
    /**
     * Creates a round-robin stage.
     *
     * Group count must be given. It will distribute participants in groups and rounds.
     */
    async roundRobin() {
        const groups = await this.getRoundRobinGroups();
        const stage = await this.createStage();
        for (let i = 0; i < groups.length; i++)
            await this.createRoundRobinGroup(stage.id, i + 1, groups[i]);
        return stage;
    }
    /**
     * Creates a single elimination stage.
     *
     * One bracket and optionally a consolation final between semi-final losers.
     */
    async singleElimination() {
        var _a, _b;
        if (Array.isArray((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.seedOrdering) &&
            ((_b = this.stage.settings) === null || _b === void 0 ? void 0 : _b.seedOrdering.length) !== 1)
            throw Error('You must specify one seed ordering method.');
        const slots = await this.getSlots();
        const stage = await this.createStage();
        const method = this.getStandardBracketFirstRoundOrdering();
        const ordered = ordering_1.ordering[method](slots);
        const { losers } = await this.createStandardBracket(stage.id, 1, ordered);
        await this.createConsolationFinal(stage.id, losers);
        return stage;
    }
    /**
     * Creates a double elimination stage.
     *
     * One upper bracket (winner bracket, WB), one lower bracket (loser bracket, LB) and optionally a grand final
     * between the winner of both bracket, which can be simple or double.
     */
    async doubleElimination() {
        var _a;
        if (this.stage.settings && Array.isArray(this.stage.settings.seedOrdering) &&
            this.stage.settings.seedOrdering.length < 1)
            throw Error('You must specify at least one seed ordering method.');
        const slots = await this.getSlots();
        const stage = await this.createStage();
        const method = this.getStandardBracketFirstRoundOrdering();
        const ordered = ordering_1.ordering[method](slots);
        if ((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.skipFirstRound)
            await this.createDoubleEliminationSkipFirstRound(stage.id, ordered);
        else
            await this.createDoubleElimination(stage.id, ordered);
        return stage;
    }
    /**
     * Creates a double elimination stage with skip first round option.
     *
     * @param stageId ID of the stage.
     * @param slots A list of slots.
     */
    async createDoubleEliminationSkipFirstRound(stageId, slots) {
        var _a;
        const { even: directInWb, odd: directInLb } = helpers.splitByParity(slots);
        const { losers: losersWb, winner: winnerWb } = await this.createStandardBracket(stageId, 1, directInWb);
        if (helpers.isDoubleEliminationNecessary((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.size)) {
            const winnerLb = await this.createLowerBracket(stageId, 2, [directInLb, ...losersWb]);
            await this.createGrandFinal(stageId, winnerWb, winnerLb);
        }
    }
    /**
     * Creates a double elimination stage.
     *
     * @param stageId ID of the stage.
     * @param slots A list of slots.
     */
    async createDoubleElimination(stageId, slots) {
        var _a;
        const { losers: losersWb, winner: winnerWb } = await this.createStandardBracket(stageId, 1, slots);
        if (helpers.isDoubleEliminationNecessary((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.size)) {
            const winnerLb = await this.createLowerBracket(stageId, 2, losersWb);
            const finalGroupId = await this.createGrandFinal(stageId, winnerWb, winnerLb);
            await this.createConsolationFinal(stageId, losersWb, {
                existingGroupId: finalGroupId,
                // Arbitrary way to differentiate the grand final and consolation final matches.
                // Grand final matches always have had `number: 1`. Now, consolation final matches always have `number: 2`.
                matchNumberStart: 2,
            });
        }
    }
    /**
     * Creates a round-robin group.
     *
     * This will make as many rounds as needed to let each participant match every other once.
     *
     * @param stageId ID of the parent stage.
     * @param groupNumber Number of the group in the stage.
     * @param slots A list of slots.
     */
    async createRoundRobinGroup(stageId, groupNumber, slots) {
        var _a;
        const groupId = await this.insertGroup({
            stage_id: stageId,
            number: groupNumber,
        });
        if (groupId === -1)
            throw Error('Could not insert the group.');
        const rounds = helpers.makeRoundRobinMatches(slots, (_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.roundRobinMode);
        for (let i = 0; i < rounds.length; i++)
            await this.createRound(stageId, groupId, i + 1, rounds[0].length, rounds[i]);
    }
    /**
     * Creates a standard bracket, which is the only one in single elimination and the upper one in double elimination.
     *
     * This will make as many rounds as needed to end with one winner.
     *
     * @param stageId ID of the parent stage.
     * @param groupNumber Number of the group in the stage.
     * @param slots A list of slots.
     */
    async createStandardBracket(stageId, groupNumber, slots) {
        const roundCount = helpers.getUpperBracketRoundCount(slots.length);
        const groupId = await this.insertGroup({
            stage_id: stageId,
            number: groupNumber,
        });
        if (groupId === -1)
            throw Error('Could not insert the group.');
        let duels = helpers.makePairs(slots);
        let roundNumber = 1;
        const losers = [];
        for (let i = roundCount - 1; i >= 0; i--) {
            const matchCount = Math.pow(2, i);
            duels = this.getCurrentDuels(duels, matchCount);
            losers.push(duels.map(helpers.byeLoser));
            await this.createRound(stageId, groupId, roundNumber++, matchCount, duels);
        }
        return { losers, winner: helpers.byeWinner(duels[0]) };
    }
    /**
     * Creates a lower bracket, alternating between major and minor rounds.
     *
     * - A major round is a regular round.
     * - A minor round matches the previous (major) round's winners against upper bracket losers of the corresponding round.
     *
     * @param stageId ID of the parent stage.
     * @param groupNumber Number of the group in the stage.
     * @param losers One list of losers per upper bracket round.
     */
    async createLowerBracket(stageId, groupNumber, losers) {
        var _a;
        const participantCount = (_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.size;
        const roundPairCount = helpers.getRoundPairCount(participantCount);
        let losersId = 0;
        const method = this.getMajorOrdering(participantCount);
        const ordered = ordering_1.ordering[method](losers[losersId++]);
        const groupId = await this.insertGroup({
            stage_id: stageId,
            number: groupNumber,
        });
        if (groupId === -1)
            throw Error('Could not insert the group.');
        let duels = helpers.makePairs(ordered);
        let roundNumber = 1;
        for (let i = 0; i < roundPairCount; i++) {
            const matchCount = Math.pow(2, roundPairCount - i - 1);
            // Major round.
            duels = this.getCurrentDuels(duels, matchCount, true);
            await this.createRound(stageId, groupId, roundNumber++, matchCount, duels);
            // Minor round.
            const minorOrdering = this.getMinorOrdering(participantCount, i, roundPairCount);
            duels = this.getCurrentDuels(duels, matchCount, false, losers[losersId++], minorOrdering);
            await this.createRound(stageId, groupId, roundNumber++, matchCount, duels);
        }
        return helpers.byeWinnerToGrandFinal(duels[0]);
    }
    /**
     * Creates a bracket with rounds that only have 1 match each. Used for finals.
     *
     * @param stageId ID of the parent stage.
     * @param groupNumber Number of the group in the stage.
     * @param duels A list of duels.
     * @param overrides Optional overrides.
     */
    async createUniqueMatchBracket(stageId, groupNumber, duels, overrides = {}) {
        let groupId = overrides.existingGroupId;
        let roundNumberStart = 1;
        if (groupId !== undefined) {
            const rounds = await this.storage.select('round', { group_id: groupId });
            if (!rounds)
                throw Error('Error getting rounds.');
            // When we add rounds to an existing group, we resume the round numbering.
            roundNumberStart = rounds.length + 1;
        }
        else {
            groupId = await this.insertGroup({
                stage_id: stageId,
                number: groupNumber,
            });
            if (groupId === -1)
                throw Error('Could not insert the group.');
        }
        for (let i = 0; i < duels.length; i++)
            await this.createRound(stageId, groupId, roundNumberStart + i, 1, [duels[i]], overrides.matchNumberStart);
        return groupId;
    }
    /**
     * Creates a round, which contain matches.
     *
     * @param stageId ID of the parent stage.
     * @param groupId ID of the parent group.
     * @param roundNumber Number in the group.
     * @param matchCount Duel/match count.
     * @param duels A list of duels.
     * @param matchNumberStart Optionally give the starting point for the match numbers. Starts at 1 by default.
     */
    async createRound(stageId, groupId, roundNumber, matchCount, duels, matchNumberStart = 1) {
        const matchesChildCount = this.getMatchesChildCount();
        const roundId = await this.insertRound({
            number: roundNumber,
            stage_id: stageId,
            group_id: groupId,
        });
        if (roundId === -1)
            throw Error('Could not insert the round.');
        for (let i = 0; i < matchCount; i++)
            await this.createMatch(stageId, groupId, roundId, matchNumberStart + i, duels[i], matchesChildCount);
    }
    /**
     * Creates a match, possibly with match games.
     *
     * - If `childCount` is 0, then there is no children. The score of the match is directly its intrinsic score.
     * - If `childCount` is greater than 0, then the score of the match will automatically be calculated based on its child games.
     *
     * @param stageId ID of the parent stage.
     * @param groupId ID of the parent group.
     * @param roundId ID of the parent round.
     * @param matchNumber Number in the round.
     * @param opponents The two opponents matching against each other.
     * @param childCount Child count for this match (number of games).
     */
    async createMatch(stageId, groupId, roundId, matchNumber, opponents, childCount) {
        const opponent1 = helpers.toResultWithPosition(opponents[0]);
        const opponent2 = helpers.toResultWithPosition(opponents[1]);
        // Round-robin matches can easily be removed. Prevent BYE vs. BYE matches.
        if (this.stage.type === 'round_robin' && opponent1 === null && opponent2 === null)
            return;
        let existing = null;
        let status = helpers.getMatchStatus(opponents);
        if (this.updateMode) {
            existing = await this.storage.selectFirst('match', {
                round_id: roundId,
                number: matchNumber,
            });
            const currentChildCount = existing === null || existing === void 0 ? void 0 : existing.child_count;
            childCount = currentChildCount === undefined ? childCount : currentChildCount;
            if (existing) {
                // Keep the most advanced status when updating a match.
                const existingStatus = helpers.getMatchStatus(existing);
                if (existingStatus > status)
                    status = existingStatus;
            }
        }
        const parentId = await this.insertMatch({
            number: matchNumber,
            stage_id: stageId,
            group_id: groupId,
            round_id: roundId,
            child_count: childCount,
            status: status,
            ...helpers.getInferredResult(opponent1, opponent2),
        }, existing);
        if (parentId === -1)
            throw Error('Could not insert the match.');
        for (let i = 0; i < childCount; i++) {
            const id = await this.insertMatchGame({
                number: i + 1,
                stage_id: stageId,
                parent_id: parentId,
                status: status,
                ...helpers.getInferredResult(helpers.toResult(opponents[0]), helpers.toResult(opponents[1])),
            });
            if (id === -1)
                throw Error('Could not insert the match game.');
        }
    }
    /**
     * Generic implementation.
     *
     * @param previousDuels Always given.
     * @param currentDuelCount Always given.
     * @param major Only for loser bracket.
     * @param losers Only for minor rounds of loser bracket.
     * @param method Only for minor rounds. Ordering method for the losers.
     */
    getCurrentDuels(previousDuels, currentDuelCount, major, losers, method) {
        if ((major === undefined || major) && previousDuels.length === currentDuelCount) {
            // First round.
            return previousDuels;
        }
        if (major === undefined || major) {
            // From major to major (WB) or minor to major (LB).
            return helpers.transitionToMajor(previousDuels);
        }
        // From major to minor (LB).
        // Losers and method won't be undefined.
        return helpers.transitionToMinor(previousDuels, losers, method);
    }
    /**
     * Returns a list of slots.
     * - If `seeding` was given, inserts them in the storage.
     * - If `size` was given, only returns a list of empty slots.
     *
     * @param positions An optional list of positions (seeds) for a manual ordering.
     */
    async getSlots(positions) {
        var _a;
        let seeding = this.stage.seedingIds || this.stage.seeding;
        const size = ((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.size) || (seeding === null || seeding === void 0 ? void 0 : seeding.length) || 0;
        helpers.ensureValidSize(this.stage.type, size);
        if (size && !seeding)
            return Array.from({ length: size }, (_, i) => ({ id: null, position: i + 1 }));
        if (!seeding)
            throw Error('Either size or seeding must be given.');
        this.stage.settings = {
            ...this.stage.settings,
            size, // Always set the size.
        };
        helpers.ensureNoDuplicates(seeding);
        seeding = helpers.fixSeeding(seeding, size);
        if (this.stage.type !== 'round_robin' && this.stage.settings.balanceByes)
            seeding = helpers.balanceByes(seeding, this.stage.settings.size);
        this.stage.seeding = seeding;
        if (this.stage.seedingIds !== undefined || helpers.isSeedingWithIds(seeding))
            return this.getSlotsUsingIds(seeding, positions);
        return this.getSlotsUsingNames(seeding, positions);
    }
    /**
     * Returns the list of slots with a seeding containing names. Participants may be added to database.
     *
     * @param seeding The seeding (names).
     * @param positions An optional list of positions (seeds) for a manual ordering.
     */
    async getSlotsUsingNames(seeding, positions) {
        const participants = helpers.extractParticipantsFromSeeding(this.stage.tournamentId, seeding);
        if (!await this.registerParticipants(participants))
            throw Error('Error registering the participants.');
        // Get participants back with IDs.
        const added = await this.storage.select('participant', { tournament_id: this.stage.tournamentId });
        if (!added)
            throw Error('Error getting registered participant.');
        return helpers.mapParticipantsNamesToDatabase(seeding, added, positions);
    }
    /**
     * Returns the list of slots with a seeding containing IDs. No database mutation.
     *
     * @param seeding The seeding (IDs).
     * @param positions An optional list of positions (seeds) for a manual ordering.
     */
    async getSlotsUsingIds(seeding, positions) {
        const participants = await this.storage.select('participant', { tournament_id: this.stage.tournamentId });
        if (!participants)
            throw Error('No available participants.');
        return helpers.mapParticipantsIdsToDatabase(seeding, participants, positions);
    }
    /**
     * Gets the current stage number based on existing stages.
     */
    async getStageNumber() {
        const stages = await this.storage.select('stage', { tournament_id: this.stage.tournamentId });
        const stageNumbers = stages === null || stages === void 0 ? void 0 : stages.map(stage => { var _a; return (_a = stage.number) !== null && _a !== void 0 ? _a : 0; });
        if (this.stage.number !== undefined) {
            if (stageNumbers === null || stageNumbers === void 0 ? void 0 : stageNumbers.includes(this.stage.number))
                throw Error('The given stage number already exists.');
            return this.stage.number;
        }
        if (!(stageNumbers === null || stageNumbers === void 0 ? void 0 : stageNumbers.length))
            return 1;
        const maxNumber = Math.max(...stageNumbers);
        return maxNumber + 1;
    }
    /**
     * Safely gets `matchesChildCount` in the stage input settings.
     */
    getMatchesChildCount() {
        var _a;
        if (!((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.matchesChildCount))
            return 0;
        return this.stage.settings.matchesChildCount;
    }
    /**
     * Safely gets an ordering by its index in the stage input settings.
     *
     * @param orderingIndex Index of the ordering.
     * @param stageType A value indicating if the method should be a group method or not.
     * @param defaultMethod The default method to use if not given.
     */
    getOrdering(orderingIndex, stageType, defaultMethod) {
        var _a;
        if (!((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.seedOrdering)) {
            this.seedOrdering.push(defaultMethod);
            return defaultMethod;
        }
        const method = this.stage.settings.seedOrdering[orderingIndex];
        if (!method) {
            this.seedOrdering.push(defaultMethod);
            return defaultMethod;
        }
        if (stageType === 'elimination' && method.match(/^groups\./))
            throw Error('You must specify a seed ordering method without a \'groups\' prefix');
        if (stageType === 'groups' && method !== 'natural' && !method.match(/^groups\./))
            throw Error('You must specify a seed ordering method with a \'groups\' prefix');
        return method;
    }
    /**
     * Gets the duels in groups for a round-robin stage.
     */
    async getRoundRobinGroups() {
        var _a, _b, _c, _d, _e;
        if (((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.groupCount) === undefined || !Number.isInteger(this.stage.settings.groupCount))
            throw Error('You must specify a group count for round-robin stages.');
        if (this.stage.settings.groupCount <= 0)
            throw Error('You must provide a strictly positive group count.');
        if ((_b = this.stage.settings) === null || _b === void 0 ? void 0 : _b.manualOrdering) {
            if (((_c = this.stage.settings) === null || _c === void 0 ? void 0 : _c.manualOrdering.length) !== ((_d = this.stage.settings) === null || _d === void 0 ? void 0 : _d.groupCount))
                throw Error('Group count in the manual ordering does not correspond to the given group count.');
            const positions = (_e = this.stage.settings) === null || _e === void 0 ? void 0 : _e.manualOrdering.flat();
            const slots = await this.getSlots(positions);
            return helpers.makeGroups(slots, this.stage.settings.groupCount);
        }
        if (Array.isArray(this.stage.settings.seedOrdering) && this.stage.settings.seedOrdering.length !== 1)
            throw Error('You must specify one seed ordering method.');
        const method = this.getRoundRobinOrdering();
        const slots = await this.getSlots();
        const ordered = ordering_1.ordering[method](slots, this.stage.settings.groupCount);
        return helpers.makeGroups(ordered, this.stage.settings.groupCount);
    }
    /**
     * Returns the ordering method for the groups in a round-robin stage.
     */
    getRoundRobinOrdering() {
        return this.getOrdering(0, 'groups', 'groups.effort_balanced');
    }
    /**
     * Returns the ordering method for the first round of the upper bracket of an elimination stage.
     */
    getStandardBracketFirstRoundOrdering() {
        return this.getOrdering(0, 'elimination', 'inner_outer');
    }
    /**
     * Safely gets the only major ordering for the lower bracket.
     *
     * @param participantCount Number of participants in the stage.
     */
    getMajorOrdering(participantCount) {
        var _a;
        return this.getOrdering(1, 'elimination', ((_a = ordering_1.defaultMinorOrdering[participantCount]) === null || _a === void 0 ? void 0 : _a[0]) || 'natural');
    }
    /**
     * Safely gets a minor ordering for the lower bracket by its index.
     *
     * @param participantCount Number of participants in the stage.
     * @param index Index of the minor round.
     * @param minorRoundCount Number of minor rounds.
     */
    getMinorOrdering(participantCount, index, minorRoundCount) {
        var _a;
        // No ordering for the last minor round. There is only one participant to order.
        if (index === minorRoundCount - 1)
            return undefined;
        return this.getOrdering(2 + index, 'elimination', ((_a = ordering_1.defaultMinorOrdering[participantCount]) === null || _a === void 0 ? void 0 : _a[1 + index]) || 'natural');
    }
    /**
     * Inserts a stage or finds an existing one.
     *
     * @param stage The stage to insert.
     */
    async insertStage(stage) {
        let existing = null;
        if (this.updateMode) {
            existing = await this.storage.select('stage', this.currentStageId);
            if (!existing)
                throw Error('Stage not found.');
            const update = {
                ...existing,
                ...stage,
                settings: {
                    ...existing.settings,
                    ...stage.settings,
                },
            };
            if (!await this.storage.update('stage', this.currentStageId, update))
                throw Error('Could not update the stage.');
        }
        if (!existing)
            return this.storage.insert('stage', stage);
        return existing.id;
    }
    /**
     * Inserts a group or finds an existing one.
     *
     * @param group The group to insert.
     */
    async insertGroup(group) {
        let existing = null;
        if (this.updateMode) {
            existing = await this.storage.selectFirst('group', {
                stage_id: group.stage_id,
                number: group.number,
            });
        }
        if (!existing)
            return this.storage.insert('group', group);
        return existing.id;
    }
    /**
     * Inserts a round or finds an existing one.
     *
     * @param round The round to insert.
     */
    async insertRound(round) {
        let existing = null;
        if (this.updateMode) {
            existing = await this.storage.selectFirst('round', {
                group_id: round.group_id,
                number: round.number,
            });
        }
        if (!existing)
            return this.storage.insert('round', round);
        return existing.id;
    }
    /**
     * Inserts a match or updates an existing one.
     *
     * @param match The match to insert.
     * @param existing An existing match corresponding to the current one.
     */
    async insertMatch(match, existing) {
        if (!existing)
            return this.storage.insert('match', match);
        const updated = helpers.getUpdatedMatchResults(match, existing, this.enableByesInUpdate);
        if (!await this.storage.update('match', existing.id, updated))
            throw Error('Could not update the match.');
        return existing.id;
    }
    /**
     * Inserts a match game or finds an existing one (and updates it).
     *
     * @param matchGame The match game to insert.
     */
    async insertMatchGame(matchGame) {
        let existing = null;
        if (this.updateMode) {
            existing = await this.storage.selectFirst('match_game', {
                parent_id: matchGame.parent_id,
                number: matchGame.number,
            });
        }
        if (!existing)
            return this.storage.insert('match_game', matchGame);
        const updated = helpers.getUpdatedMatchResults(matchGame, existing, this.enableByesInUpdate);
        if (!await this.storage.update('match_game', existing.id, updated))
            throw Error('Could not update the match game.');
        return existing.id;
    }
    /**
     * Inserts missing participants.
     *
     * @param participants The list of participants to process.
     */
    async registerParticipants(participants) {
        const existing = await this.storage.select('participant', { tournament_id: this.stage.tournamentId });
        // Insert all if nothing.
        if (!existing || existing.length === 0)
            return this.storage.insert('participant', participants);
        // Insert only missing otherwise.
        for (const participant of participants) {
            if (existing.some(value => value.name === participant.name))
                continue;
            const result = await this.storage.insert('participant', participant);
            if (result === -1)
                return false;
        }
        return true;
    }
    /**
     * Creates a new stage.
     */
    async createStage() {
        const stageNumber = await this.getStageNumber();
        const stage = {
            tournament_id: this.stage.tournamentId,
            name: this.stage.name,
            type: this.stage.type,
            number: stageNumber,
            settings: this.stage.settings || {},
        };
        const stageId = await this.insertStage(stage);
        if (stageId === -1)
            throw Error('Could not insert the stage.');
        return { ...stage, id: stageId };
    }
    /**
     * Creates a consolation final for the semi final losers of an upper bracket (single or double elimination).
     *
     * @param stageId ID of the stage.
     * @param losers The semi final losers who will play the consolation final.
     * @param overrides Optional overrides.
     */
    async createConsolationFinal(stageId, losers, overrides = {}) {
        var _a;
        if (!((_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.consolationFinal))
            return;
        const semiFinalLosers = losers[losers.length - 2];
        await this.createUniqueMatchBracket(stageId, 2, [semiFinalLosers], overrides);
    }
    /**
     * Creates a grand final (none, simple or double) for winners of both bracket in a double elimination stage.
     *
     * @param stageId ID of the stage.
     * @param winnerWb The winner of the winner bracket.
     * @param winnerLb The winner of the loser bracket.
     */
    async createGrandFinal(stageId, winnerWb, winnerLb) {
        var _a;
        // No Grand Final by default.
        const grandFinal = (_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.grandFinal;
        if (grandFinal === 'none')
            return;
        // One duel by default.
        const finalDuels = [[winnerWb, winnerLb]];
        // Second duel.
        if (grandFinal === 'double')
            finalDuels.push([{ id: null }, { id: null }]);
        const groupId = await this.createUniqueMatchBracket(stageId, 3, finalDuels);
        return groupId;
    }
    /**
     * Ensures that the seed ordering list is stored even if it was not given in the first place.
     *
     * @param stageId ID of the stage.
     */
    async ensureSeedOrdering(stageId) {
        var _a, _b;
        if (((_b = (_a = this.stage.settings) === null || _a === void 0 ? void 0 : _a.seedOrdering) === null || _b === void 0 ? void 0 : _b.length) === this.seedOrdering.length)
            return;
        const existing = await this.storage.select('stage', stageId);
        if (!existing)
            throw Error('Stage not found.');
        const update = {
            ...existing,
            settings: {
                ...existing.settings,
                seedOrdering: this.seedOrdering,
            },
        };
        if (!await this.storage.update('stage', stageId, update))
            throw Error('Could not update the stage.');
    }
}
exports.StageCreator = StageCreator;

},{"../../helpers":8,"../../ordering":10}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseUpdater = void 0;
const brackets_model_1 = require("brackets-model");
const ordering_1 = require("../ordering");
const creator_1 = require("./stage/creator");
const getter_1 = require("./getter");
const get_1 = require("../get");
const helpers = require("../helpers");
class BaseUpdater extends getter_1.BaseGetter {
    /**
     * Updates or resets the seeding of a stage.
     *
     * @param stageId ID of the stage.
     * @param seeding A new seeding or `null` to reset the existing seeding.
     * @param seeding.seeding Can contain names, IDs or BYEs.
     * @param seeding.seedingIds Can only contain IDs or BYEs.
     * @param keepSameSize Whether to keep the same size as before for the stage.
     */
    async updateSeeding(stageId, { seeding, seedingIds }, keepSameSize) {
        var _a, _b;
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        const newSize = keepSameSize ? stage.settings.size : (_b = (_a = (seedingIds || seeding)) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
        const creator = new creator_1.StageCreator(this.storage, {
            name: stage.name,
            tournamentId: stage.tournament_id,
            type: stage.type,
            settings: {
                ...stage.settings,
                ...(newSize === 0 ? {} : { size: newSize }), // Just reset the seeding if the new size is going to be empty.
            },
            ...((seedingIds ? { seedingIds } : { seeding: seeding !== null && seeding !== void 0 ? seeding : undefined })),
        });
        creator.setExisting(stageId, false);
        const method = getter_1.BaseGetter.getSeedingOrdering(stage.type, creator);
        const slots = await creator.getSlots();
        const matches = await this.getSeedingMatches(stage.id, stage.type);
        if (!matches)
            throw Error('Error getting matches associated to the seeding.');
        const ordered = ordering_1.ordering[method](slots);
        BaseUpdater.assertCanUpdateSeeding(matches, ordered);
        await creator.run();
    }
    /**
     * Confirms the current seeding of a stage.
     *
     * @param stageId ID of the stage.
     */
    async confirmCurrentSeeding(stageId) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        const get = new get_1.Get(this.storage);
        const currentSeeding = await get.seeding(stageId);
        const newSeeding = helpers.convertSlotsToSeeding(currentSeeding.map(helpers.convertTBDtoBYE));
        const creator = new creator_1.StageCreator(this.storage, {
            name: stage.name,
            tournamentId: stage.tournament_id,
            type: stage.type,
            settings: stage.settings,
            seeding: newSeeding,
        });
        creator.setExisting(stageId, true);
        await creator.run();
    }
    /**
     * Updates a parent match based on its child games.
     *
     * @param parentId ID of the parent match.
     * @param inRoundRobin Indicates whether the parent match is in a round-robin stage.
     */
    async updateParentMatch(parentId, inRoundRobin) {
        const storedParent = await this.storage.select('match', parentId);
        if (!storedParent)
            throw Error('Parent not found.');
        const games = await this.storage.select('match_game', { parent_id: parentId });
        if (!games)
            throw Error('No match games.');
        const parentScores = helpers.getChildGamesResults(games);
        const parent = helpers.getParentMatchResults(storedParent, parentScores);
        helpers.setParentMatchCompleted(parent, storedParent.child_count, inRoundRobin);
        await this.updateMatch(storedParent, parent, true);
    }
    /**
     * Throws an error if a match is locked and the new seeding will change this match's participants.
     *
     * @param matches The matches stored in the database.
     * @param slots The slots to check from the new seeding.
     */
    static assertCanUpdateSeeding(matches, slots) {
        var _a, _b;
        let index = 0;
        for (const match of matches) {
            // Changing the seeding would reset the matches of round >= 2, leaving the scores behind, with no participants.
            if (match.status === brackets_model_1.Status.Archived)
                throw Error('A match of round 1 is archived, which means round 2 was started.');
            const opponent1 = slots[index++];
            const opponent2 = slots[index++];
            const isParticipantLocked = helpers.isMatchParticipantLocked(match);
            // The match is participant locked, and the participants would have to change.
            if (isParticipantLocked && (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.id) !== (opponent1 === null || opponent1 === void 0 ? void 0 : opponent1.id) || ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.id) !== (opponent2 === null || opponent2 === void 0 ? void 0 : opponent2.id)))
                throw Error('A match is locked.');
        }
    }
    /**
     * Updates the matches related (previous and next) to a match.
     *
     * @param match A match.
     * @param updatePrevious Whether to update the previous matches.
     * @param updateNext Whether to update the next matches.
     */
    async updateRelatedMatches(match, updatePrevious, updateNext) {
        // This is a consolation match (doesn't have a `group_id`, nor a `round_id`).
        // It doesn't have any related matches from the POV of the library, because the 
        // creation of consolation matches is handled by the user.
        if (match.round_id === undefined)
            return;
        const { roundNumber, roundCount } = await this.getRoundPositionalInfo(match.round_id);
        const stage = await this.storage.select('stage', match.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        const group = await this.storage.select('group', match.group_id);
        if (!group)
            throw Error('Group not found.');
        const matchLocation = helpers.getMatchLocation(stage.type, group.number);
        updatePrevious && await this.updatePrevious(match, matchLocation, stage, roundNumber);
        updateNext && await this.updateNext(match, matchLocation, stage, roundNumber, roundCount);
    }
    /**
     * Updates a match based on a partial match.
     *
     * @param stored A reference to what will be updated in the storage.
     * @param match Input of the update.
     * @param force Whether to force update locked matches.
     */
    async updateMatch(stored, match, force) {
        if (!force && helpers.isMatchUpdateLocked(stored))
            throw Error('The match is locked.');
        const stage = await this.storage.select('stage', stored.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        const inRoundRobin = helpers.isRoundRobin(stage);
        const { statusChanged, resultChanged } = helpers.setMatchResults(stored, match, inRoundRobin);
        await this.applyMatchUpdate(stored);
        // Don't update related matches if it's a simple score update.
        if (!statusChanged && !resultChanged)
            return;
        if (!helpers.isRoundRobin(stage))
            await this.updateRelatedMatches(stored, statusChanged, resultChanged);
    }
    /**
     * Updates a match game based on a partial match game.
     *
     * @param stored A reference to what will be updated in the storage.
     * @param game Input of the update.
     */
    async updateMatchGame(stored, game) {
        if (helpers.isMatchUpdateLocked(stored))
            throw Error('The match game is locked.');
        const stage = await this.storage.select('stage', stored.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        const inRoundRobin = helpers.isRoundRobin(stage);
        helpers.setMatchResults(stored, game, inRoundRobin);
        if (!await this.storage.update('match_game', stored.id, stored))
            throw Error('Could not update the match game.');
        await this.updateParentMatch(stored.parent_id, inRoundRobin);
    }
    /**
     * Updates the opponents and status of a match and its child games.
     *
     * @param match A match.
     */
    async applyMatchUpdate(match) {
        if (!await this.storage.update('match', match.id, match))
            throw Error('Could not update the match.');
        if (match.child_count === 0)
            return;
        const updatedMatchGame = {
            opponent1: helpers.toResult(match.opponent1),
            opponent2: helpers.toResult(match.opponent2),
        };
        // Only sync the child games' status with their parent's status when changing the parent match participants
        // (Locked, Waiting, Ready) or when archiving the parent match.
        if (match.status <= brackets_model_1.Status.Ready || match.status === brackets_model_1.Status.Archived)
            updatedMatchGame.status = match.status;
        if (!await this.storage.update('match_game', { parent_id: match.id }, updatedMatchGame))
            throw Error('Could not update the match game.');
    }
    /**
     * Updates the match(es) leading to the current match based on this match results.
     *
     * @param match Input of the update.
     * @param matchLocation Location of the current match.
     * @param stage The parent stage.
     * @param roundNumber Number of the round.
     */
    async updatePrevious(match, matchLocation, stage, roundNumber) {
        const previousMatches = await this.getPreviousMatches(match, matchLocation, stage, roundNumber);
        if (previousMatches.length === 0)
            return;
        if (match.status >= brackets_model_1.Status.Running)
            await this.archiveMatches(previousMatches);
        else
            await this.resetMatchesStatus(previousMatches);
    }
    /**
     * Sets the status of a list of matches to archived.
     *
     * @param matches The matches to update.
     */
    async archiveMatches(matches) {
        for (const match of matches) {
            if (match.status === brackets_model_1.Status.Archived)
                continue;
            match.status = brackets_model_1.Status.Archived;
            await this.applyMatchUpdate(match);
        }
    }
    /**
     * Resets the status of a list of matches to what it should currently be.
     *
     * @param matches The matches to update.
     */
    async resetMatchesStatus(matches) {
        for (const match of matches) {
            match.status = helpers.getMatchStatus(match);
            await this.applyMatchUpdate(match);
        }
    }
    /**
     * Updates the match(es) following the current match based on this match results.
     *
     * @param match Input of the update.
     * @param matchLocation Location of the current match.
     * @param stage The parent stage.
     * @param roundNumber Number of the round.
     * @param roundCount Count of rounds.
     */
    async updateNext(match, matchLocation, stage, roundNumber, roundCount) {
        const nextMatches = await this.getNextMatches(match, matchLocation, stage, roundNumber, roundCount);
        if (nextMatches.length === 0) {
            // Archive match if it doesn't have following matches and is completed.
            // When the stage is fully complete, all matches should be archived.
            if (match.status === brackets_model_1.Status.Completed)
                await this.archiveMatches([match]);
            return;
        }
        const winnerSide = helpers.getMatchResult(match);
        const actualRoundNumber = (stage.settings.skipFirstRound && matchLocation === 'winner_bracket') ? roundNumber + 1 : roundNumber;
        if (winnerSide)
            await this.applyToNextMatches(helpers.setNextOpponent, match, matchLocation, actualRoundNumber, roundCount, nextMatches, winnerSide);
        else
            await this.applyToNextMatches(helpers.resetNextOpponent, match, matchLocation, actualRoundNumber, roundCount, nextMatches);
    }
    /**
     * Applies a `SetNextOpponent` function to matches following the current match.
     *
     * - `nextMatches[0]` is assumed to be next match for the winner of the current match.
     * - `nextMatches[1]` is assumed to be next match for the loser of the current match.
     *
     * @param setNextOpponent The `SetNextOpponent` function.
     * @param match The current match.
     * @param matchLocation Location of the current match.
     * @param roundNumber Number of the current round.
     * @param roundCount Count of rounds.
     * @param nextMatches The matches following the current match.
     * @param winnerSide Side of the winner in the current match.
     */
    async applyToNextMatches(setNextOpponent, match, matchLocation, roundNumber, roundCount, nextMatches, winnerSide) {
        if (matchLocation === 'final_group') {
            if (!nextMatches[0])
                throw Error('First next match is null.');
            setNextOpponent(nextMatches[0], 'opponent1', match, 'opponent1');
            setNextOpponent(nextMatches[0], 'opponent2', match, 'opponent2');
            await this.applyMatchUpdate(nextMatches[0]);
            return;
        }
        const nextSide = helpers.getNextSide(match.number, roundNumber, roundCount, matchLocation);
        // First next match
        if (nextMatches[0]) {
            setNextOpponent(nextMatches[0], nextSide, match, winnerSide);
            await this.propagateByeWinners(nextMatches[0]);
        }
        if (nextMatches.length !== 2)
            return;
        if (!nextMatches[1])
            throw Error('Second next match is null.');
        // Second next match
        if (matchLocation === 'single_bracket') {
            // Going into consolation final (single elimination)
            setNextOpponent(nextMatches[1], nextSide, match, winnerSide && helpers.getOtherSide(winnerSide));
            await this.applyMatchUpdate(nextMatches[1]);
        }
        else if (matchLocation === 'winner_bracket') {
            // Going into loser bracket match (double elimination)
            const nextSideIntoLB = helpers.getNextSideLoserBracket(match.number, nextMatches[1], roundNumber);
            setNextOpponent(nextMatches[1], nextSideIntoLB, match, winnerSide && helpers.getOtherSide(winnerSide));
            await this.propagateByeWinners(nextMatches[1]);
        }
        else if (matchLocation === 'loser_bracket') {
            // Going into consolation final (double elimination)
            const nextSideIntoConsolationFinal = helpers.getNextSideConsolationFinalDoubleElimination(roundNumber);
            setNextOpponent(nextMatches[1], nextSideIntoConsolationFinal, match, winnerSide && helpers.getOtherSide(winnerSide));
            await this.propagateByeWinners(nextMatches[1]);
        }
    }
    /**
     * Propagates winner against BYEs in related matches.
     *
     * @param match The current match.
     */
    async propagateByeWinners(match) {
        helpers.setMatchResults(match, match, false); // BYE propagation is only in non round-robin stages.
        await this.applyMatchUpdate(match);
        if (helpers.hasBye(match))
            await this.updateRelatedMatches(match, true, true);
    }
}
exports.BaseUpdater = BaseUpdater;

},{"../get":7,"../helpers":8,"../ordering":10,"./getter":1,"./stage/creator":2,"brackets-model":14}],4:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Create = void 0;
const creator_1 = require("./base/stage/creator");
class Create {
    /**
     * Creates an instance of Create.
     *
     * @param storage The implementation of Storage.
     */
    constructor(storage) {
        this.storage = storage;
    }
    /**
     * Creates a stage for an existing tournament. The tournament won't be created.
     *
     * @param data The stage to create.
     */
    async stage(data) {
        const creator = new creator_1.StageCreator(this.storage, data);
        return creator.run();
    }
}
exports.Create = Create;

},{"./base/stage/creator":2}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Delete = void 0;
class Delete {
    /**
     * Creates an instance of Delete, which will handle cleanly deleting data in the storage.
     *
     * @param storage The implementation of Storage.
     */
    constructor(storage) {
        this.storage = storage;
    }
    /**
     * Deletes a stage, and all its components:
     *
     * - Groups
     * - Rounds
     * - Matches
     * - Match games
     *
     * @param stageId ID of the stage.
     */
    async stage(stageId) {
        // The order is important here, because the abstract storage can possibly have foreign key checks (e.g. SQL).
        if (!await this.storage.delete('match_game', { stage_id: stageId }))
            throw Error('Could not delete match games.');
        if (!await this.storage.delete('match', { stage_id: stageId }))
            throw Error('Could not delete matches.');
        if (!await this.storage.delete('round', { stage_id: stageId }))
            throw Error('Could not delete rounds.');
        if (!await this.storage.delete('group', { stage_id: stageId }))
            throw Error('Could not delete groups.');
        if (!await this.storage.delete('stage', { id: stageId }))
            throw Error('Could not delete the stage.');
    }
    /**
     * Deletes **the stages** of a tournament (and all their components, see {@link stage | delete.stage()}).
     *
     * You are responsible for deleting the tournament itself.
     *
     * @param tournamentId ID of the tournament.
     */
    async tournament(tournamentId) {
        const stages = await this.storage.select('stage', { tournament_id: tournamentId });
        if (!stages)
            throw Error('Error getting the stages.');
        // Not doing this in a `Promise.all()` since this can be a heavy operation.
        for (const stage of stages)
            await this.stage(stage.id);
    }
}
exports.Delete = Delete;

},{}],6:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Find = void 0;
const getter_1 = require("./base/getter");
const helpers = require("./helpers");
class Find extends getter_1.BaseGetter {
    /**
     * Gets the upper bracket (the only bracket if single elimination or the winner bracket in double elimination).
     *
     * @param stageId ID of the stage.
     */
    async upperBracket(stageId) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        switch (stage.type) {
            case 'round_robin':
                throw Error('Round-robin stages do not have an upper bracket.');
            case 'single_elimination':
            case 'double_elimination':
                return this.getUpperBracket(stageId);
            default:
                throw Error('Unknown stage type.');
        }
    }
    /**
     * Gets the loser bracket.
     *
     * @param stageId ID of the stage.
     */
    async loserBracket(stageId) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        switch (stage.type) {
            case 'round_robin':
                throw Error('Round-robin stages do not have a loser bracket.');
            case 'single_elimination':
                throw Error('Single elimination stages do not have a loser bracket.');
            case 'double_elimination':
                const group = await this.getLoserBracket(stageId);
                if (!group)
                    throw Error('Loser bracket not found.');
                return group;
            default:
                throw Error('Unknown stage type.');
        }
    }
    /**
     * Returns the matches leading to the given match.
     *
     * If a `participantId` is given, the previous match _from their point of view_ is returned.
     *
     * @param matchId ID of the target match.
     * @param participantId Optional ID of the participant.
     */
    async previousMatches(matchId, participantId) {
        const match = await this.storage.select('match', matchId);
        if (!match)
            throw Error('Match not found.');
        const stage = await this.storage.select('stage', match.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        const group = await this.storage.select('group', match.group_id);
        if (!group)
            throw Error('Group not found.');
        const round = await this.storage.select('round', match.round_id);
        if (!round)
            throw Error('Round not found.');
        const matchLocation = helpers.getMatchLocation(stage.type, group.number);
        const previousMatches = await this.getPreviousMatches(match, matchLocation, stage, round.number);
        if (participantId !== undefined)
            return previousMatches.filter(m => helpers.isParticipantInMatch(m, participantId));
        return previousMatches;
    }
    /**
     * Returns the matches following the given match.
     *
     * If a `participantId` is given:
     * - If the participant won, the next match _from their point of view_ is returned.
     * - If the participant is eliminated, no match is returned.
     *
     * @param matchId ID of the target match.
     * @param participantId Optional ID of the participant.
     */
    async nextMatches(matchId, participantId) {
        const match = await this.storage.select('match', matchId);
        if (!match)
            throw Error('Match not found.');
        const stage = await this.storage.select('stage', match.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        const group = await this.storage.select('group', match.group_id);
        if (!group)
            throw Error('Group not found.');
        const { roundNumber, roundCount } = await this.getRoundPositionalInfo(match.round_id);
        const matchLocation = helpers.getMatchLocation(stage.type, group.number);
        const nextMatches = helpers.getNonNull(await this.getNextMatches(match, matchLocation, stage, roundNumber, roundCount));
        if (participantId !== undefined) {
            if (!helpers.isParticipantInMatch(match, participantId))
                throw Error('The participant does not belong to this match.');
            if (!helpers.isMatchStale(match))
                throw Error('The match is not stale yet, so it is not possible to conclude the next matches for this participant.');
            const loser = helpers.getLoser(match);
            if (stage.type === 'single_elimination' && (loser === null || loser === void 0 ? void 0 : loser.id) === participantId)
                return []; // Eliminated.
            if (stage.type === 'double_elimination') {
                // TODO: refactor `getNextMatches()` to return 1 next match per group. Then we can get rid of `getMatchesByGroupDoubleElimination()`.
                const { winnerBracketMatch, loserBracketMatch, finalGroupMatch } = await this.getMatchesByGroupDoubleElimination(nextMatches, new Map([[group.id, group]]));
                const winner = helpers.getWinner(match);
                if (matchLocation === 'loser_bracket') {
                    if (participantId === (loser === null || loser === void 0 ? void 0 : loser.id))
                        return []; // Eliminated from lower bracket.
                    if (participantId === (winner === null || winner === void 0 ? void 0 : winner.id))
                        return loserBracketMatch ? [loserBracketMatch] : [];
                }
                else if (matchLocation === 'winner_bracket') {
                    if (!loserBracketMatch)
                        throw Error('All matches of winner bracket should lead to loser bracket.');
                    if (participantId === (loser === null || loser === void 0 ? void 0 : loser.id))
                        return [loserBracketMatch]; // Eliminated from upper bracket, going to lower bracket.
                    if (participantId === (winner === null || winner === void 0 ? void 0 : winner.id))
                        return winnerBracketMatch ? [winnerBracketMatch] : [];
                }
                else if (matchLocation === 'final_group') {
                    if (!finalGroupMatch)
                        throw Error('All matches of a final group should also lead to the final group.');
                    return [finalGroupMatch];
                }
            }
        }
        return nextMatches;
    }
    /**
     * Finds a match in a given group. The match must have the given number in a round of which the number in group is given.
     *
     * **Example:** In group of id 1, give me the 4th match in the 3rd round.
     *
     * @param groupId ID of the group.
     * @param roundNumber Number of the round in its parent group.
     * @param matchNumber Number of the match in its parent round.
     */
    async match(groupId, roundNumber, matchNumber) {
        return this.findMatch(groupId, roundNumber, matchNumber);
    }
    /**
     * Finds a match game based on its `id` or based on the combination of its `parent_id` and `number`.
     *
     * @param game Values to change in a match game.
     */
    async matchGame(game) {
        return this.findMatchGame(game);
    }
    /**
     * Returns an object with 1 match per group type. Only supports double elimination.
     *
     * @param matches A list of matches.
     * @param fetchedGroups A map of groups which were already fetched.
     */
    async getMatchesByGroupDoubleElimination(matches, fetchedGroups) {
        var _a, _b, _c;
        const getGroup = async (groupId) => {
            const existing = fetchedGroups.get(groupId);
            if (existing)
                return existing;
            const group = await this.storage.select('group', groupId);
            if (!group)
                throw Error('Group not found.');
            fetchedGroups.set(groupId, group);
            return group;
        };
        let matchByGroupType = {};
        for (const match of matches) {
            const group = await getGroup(match.group_id);
            matchByGroupType = {
                winnerBracketMatch: (_a = matchByGroupType['winnerBracketMatch']) !== null && _a !== void 0 ? _a : (helpers.isWinnerBracket('double_elimination', group.number) ? match : undefined),
                loserBracketMatch: (_b = matchByGroupType['loserBracketMatch']) !== null && _b !== void 0 ? _b : (helpers.isLoserBracket('double_elimination', group.number) ? match : undefined),
                finalGroupMatch: (_c = matchByGroupType['finalGroupMatch']) !== null && _c !== void 0 ? _c : (helpers.isFinalGroup('double_elimination', group.number) ? match : undefined),
            };
        }
        return matchByGroupType;
    }
}
exports.Find = Find;

},{"./base/getter":1,"./helpers":8}],7:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Get = void 0;
const brackets_model_1 = require("brackets-model");
const getter_1 = require("./base/getter");
const helpers = require("./helpers");
class Get extends getter_1.BaseGetter {
    /**
     * Returns the data needed to display a stage.
     *
     * @param stageId ID of the stage.
     */
    async stageData(stageId) {
        const stageData = await this.getStageSpecificData(stageId);
        const participants = await this.storage.select('participant', { tournament_id: stageData.stage.tournament_id });
        if (!participants)
            throw Error('Error getting participants.');
        return {
            stage: [stageData.stage],
            group: stageData.groups,
            round: stageData.rounds,
            match: stageData.matches,
            match_game: stageData.matchGames,
            participant: participants,
        };
    }
    /**
     * Returns the data needed to display a whole tournament with all its stages.
     *
     * @param tournamentId ID of the tournament.
     */
    async tournamentData(tournamentId) {
        const stages = await this.storage.select('stage', { tournament_id: tournamentId });
        if (!stages)
            throw Error('Error getting stages.');
        const stagesData = await Promise.all(stages.map(stage => this.getStageSpecificData(stage.id)));
        const participants = await this.storage.select('participant', { tournament_id: tournamentId });
        if (!participants)
            throw Error('Error getting participants.');
        return {
            stage: stages,
            group: stagesData.reduce((acc, data) => [...acc, ...data.groups], []),
            round: stagesData.reduce((acc, data) => [...acc, ...data.rounds], []),
            match: stagesData.reduce((acc, data) => [...acc, ...data.matches], []),
            match_game: stagesData.reduce((acc, data) => [...acc, ...data.matchGames], []),
            participant: participants,
        };
    }
    /**
     * Returns the match games associated to a list of matches.
     *
     * @param matches A list of matches.
     */
    async matchGames(matches) {
        const parentMatches = matches.filter(match => match.child_count > 0);
        const matchGamesQueries = await Promise.all(parentMatches.map(match => this.storage.select('match_game', { parent_id: match.id })));
        if (matchGamesQueries.some(game => game === null))
            throw Error('Error getting match games.');
        return helpers.getNonNull(matchGamesQueries).flat();
    }
    /**
     * Returns the stage that is not completed yet, because of uncompleted matches.
     * If all matches are completed in this tournament, there is no "current stage", so `null` is returned.
     *
     * @param tournamentId ID of the tournament.
     */
    async currentStage(tournamentId) {
        const stages = await this.storage.select('stage', { tournament_id: tournamentId });
        if (!stages)
            throw Error('Error getting stages.');
        for (const stage of stages) {
            const matches = await this.storage.select('match', { stage_id: stage.id });
            if (!matches)
                throw Error('Error getting matches.');
            if (matches.every(match => match.status >= brackets_model_1.Status.Completed))
                continue;
            return stage;
        }
        return null;
    }
    /**
     * Returns the round that is not completed yet, because of uncompleted matches.
     * If all matches are completed in this stage of a tournament, there is no "current round", so `null` is returned.
     *
     * Note: The consolation final of single elimination and the grand final of double elimination will be in a different `Group`.
     *
     * @param stageId ID of the stage.
     * @example
     * If you don't know the stage id, you can first get the current stage.
     * ```js
     * const tournamentId = 3;
     * const currentStage = await manager.get.currentStage(tournamentId);
     * const currentRound = await manager.get.currentRound(currentStage.id);
     * ```
     */
    async currentRound(stageId) {
        const matches = await this.storage.select('match', { stage_id: stageId });
        if (!matches)
            throw Error('Error getting matches.');
        const matchesByRound = helpers.splitBy(matches, 'round_id');
        for (const roundMatches of matchesByRound) {
            if (roundMatches.every(match => match.status >= brackets_model_1.Status.Completed))
                continue;
            const round = await this.storage.select('round', roundMatches[0].round_id);
            if (!round)
                throw Error('Round not found.');
            return round;
        }
        return null;
    }
    /**
     * Returns the matches that can currently be played in parallel.
     * If the stage doesn't contain any, an empty array is returned.
     *
     * Note:
     * - Returned matches are ongoing (i.e. ready or running).
     * - Returned matches can be from different rounds.
     *
     * @param stageId ID of the stage.
     * @example
     * If you don't know the stage id, you can first get the current stage.
     * ```js
     * const tournamentId = 3;
     * const currentStage = await manager.get.currentStage(tournamentId);
     * const currentMatches = await manager.get.currentMatches(currentStage.id);
     * ```
     */
    async currentMatches(stageId) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        // TODO: Implement this for all stage types.
        // - For round robin, 1 round per group can be played in parallel at their own pace.
        // - For double elimination, 1 round per bracket (upper and lower) can be played in parallel at their own pace.
        if (stage.type !== 'single_elimination')
            throw Error('Not implemented for round robin and double elimination. Ask if needed.');
        const matches = await this.storage.select('match', { stage_id: stageId });
        if (!matches)
            throw Error('Error getting matches.');
        const matchesByRound = helpers.splitBy(matches, 'round_id');
        const roundCount = helpers.getUpperBracketRoundCount(stage.settings.size);
        // Save multiple queries for `round`.
        let currentRoundIndex = -1;
        const currentMatches = [];
        for (const roundMatches of matchesByRound) {
            currentRoundIndex++;
            if (stage.settings.consolationFinal && currentRoundIndex === roundCount - 1) {
                // We are on the final of the single elimination.
                const [final] = roundMatches;
                const [consolationFinal] = matchesByRound[currentRoundIndex + 1];
                const finals = [final, consolationFinal];
                if (finals.every(match => !helpers.isMatchOngoing(match)))
                    return [];
                return finals.filter(match => helpers.isMatchOngoing(match));
            }
            if (roundMatches.every(match => !helpers.isMatchOngoing(match)))
                continue;
            currentMatches.push(...roundMatches.filter(match => helpers.isMatchOngoing(match)));
        }
        return currentMatches;
    }
    /**
     * Returns the seeding of a stage.
     *
     * @param stageId ID of the stage.
     */
    async seeding(stageId) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        const pickRelevantProps = (slot) => {
            if (slot === null)
                return null;
            const { id, position } = slot;
            return { id, position };
        };
        if (stage.type === 'round_robin')
            return (await this.roundRobinSeeding(stage)).map(pickRelevantProps);
        return (await this.eliminationSeeding(stage)).map(pickRelevantProps);
    }
    /**
     * Returns the final standings of a stage.
     *
     * @param stageId ID of the stage.
     */
    async finalStandings(stageId) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        switch (stage.type) {
            case 'round_robin':
                throw Error('A round-robin stage does not have standings.');
            case 'single_elimination':
                return this.singleEliminationStandings(stageId);
            case 'double_elimination':
                return this.doubleEliminationStandings(stageId);
            default:
                throw Error('Unknown stage type.');
        }
    }
    /**
     * Returns the seeding of a round-robin stage.
     *
     * @param stage The stage.
     */
    async roundRobinSeeding(stage) {
        if (stage.settings.size === undefined)
            throw Error('The size of the seeding is undefined.');
        const matches = await this.storage.select('match', { stage_id: stage.id });
        if (!matches)
            throw Error('Error getting matches.');
        const slots = helpers.convertMatchesToSeeding(matches);
        // BYE vs. BYE matches of a round-robin stage are removed
        // when the stage is created. We need to add them back temporarily.
        if (slots.length < stage.settings.size) {
            const diff = stage.settings.size - slots.length;
            for (let i = 0; i < diff; i++)
                slots.push(null);
        }
        const unique = helpers.uniqueBy(slots, item => item && item.position);
        const seeding = helpers.setArraySize(unique, stage.settings.size, null);
        return seeding;
    }
    /**
     * Returns the seeding of an elimination stage.
     *
     * @param stage The stage.
     */
    async eliminationSeeding(stage) {
        const firstRound = await this.storage.selectFirst('round', { stage_id: stage.id, number: 1 }, false);
        if (!firstRound)
            throw Error('Error getting the first round.');
        const matches = await this.storage.select('match', { round_id: firstRound.id });
        if (!matches)
            throw Error('Error getting matches.');
        return helpers.convertMatchesToSeeding(matches);
    }
    /**
     * Returns the final standings of a single elimination stage.
     *
     * @param stageId ID of the stage.
     */
    async singleEliminationStandings(stageId) {
        var _a;
        const grouped = [];
        const { stage: stages, group: groups, match: matches, participant: participants } = await this.stageData(stageId);
        const [stage] = stages;
        const [singleBracket, finalGroup] = groups;
        const final = matches.filter(match => match.group_id === singleBracket.id).pop();
        if (!final)
            throw Error('Final not found.');
        // 1st place: Final winner.
        grouped[0] = [helpers.findParticipant(participants, getFinalWinnerIfDefined(final))];
        // Rest: every loser in reverse order.
        const losers = helpers.getLosers(participants, matches.filter(match => match.group_id === singleBracket.id));
        grouped.push(...losers.reverse());
        if ((_a = stage.settings) === null || _a === void 0 ? void 0 : _a.consolationFinal) {
            const consolationFinal = matches.filter(match => match.group_id === finalGroup.id).pop();
            if (!consolationFinal)
                throw Error('Consolation final not found.');
            const consolationFinalWinner = helpers.findParticipant(participants, getFinalWinnerIfDefined(consolationFinal));
            const consolationFinalLoser = helpers.findParticipant(participants, helpers.getLoser(consolationFinal));
            // Overwrite semi-final losers with the consolation final results.
            grouped.splice(2, 1, [consolationFinalWinner], [consolationFinalLoser]);
        }
        return helpers.makeFinalStandings(grouped);
    }
    /**
     * Returns the final standings of a double elimination stage.
     *
     * @param stageId ID of the stage.
     */
    async doubleEliminationStandings(stageId) {
        var _a, _b;
        const grouped = [];
        const { stage: stages, group: groups, match: matches, participant: participants } = await this.stageData(stageId);
        const [stage] = stages;
        const [winnerBracket, loserBracket, finalGroup] = groups;
        if (((_a = stage.settings) === null || _a === void 0 ? void 0 : _a.grandFinal) === 'none') {
            const finalWB = matches.filter(match => match.group_id === winnerBracket.id).pop();
            if (!finalWB)
                throw Error('WB final not found.');
            const finalLB = matches.filter(match => match.group_id === loserBracket.id).pop();
            if (!finalLB)
                throw Error('LB final not found.');
            // 1st place: WB Final winner.
            grouped[0] = [helpers.findParticipant(participants, getFinalWinnerIfDefined(finalWB))];
            // 2nd place: LB Final winner.
            grouped[1] = [helpers.findParticipant(participants, getFinalWinnerIfDefined(finalLB))];
        }
        else {
            const grandFinalMatches = matches.filter(match => match.group_id === finalGroup.id);
            const decisiveMatch = helpers.getGrandFinalDecisiveMatch(((_b = stage.settings) === null || _b === void 0 ? void 0 : _b.grandFinal) || 'none', grandFinalMatches);
            // 1st place: Grand Final winner.
            grouped[0] = [helpers.findParticipant(participants, getFinalWinnerIfDefined(decisiveMatch))];
            // 2nd place: Grand Final loser.
            grouped[1] = [helpers.findParticipant(participants, helpers.getLoser(decisiveMatch))];
        }
        // Rest: every loser in reverse order.
        const losers = helpers.getLosers(participants, matches.filter(match => match.group_id === loserBracket.id));
        grouped.push(...losers.reverse());
        return helpers.makeFinalStandings(grouped);
    }
    /**
     * Returns only the data specific to the given stage (without the participants).
     *
     * @param stageId ID of the stage.
     */
    async getStageSpecificData(stageId) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        const groups = await this.storage.select('group', { stage_id: stageId });
        if (!groups)
            throw Error('Error getting groups.');
        const rounds = await this.storage.select('round', { stage_id: stageId });
        if (!rounds)
            throw Error('Error getting rounds.');
        const matches = await this.storage.select('match', { stage_id: stageId });
        if (!matches)
            throw Error('Error getting matches.');
        const matchGames = await this.matchGames(matches);
        return {
            stage,
            groups,
            rounds,
            matches,
            matchGames,
        };
    }
}
exports.Get = Get;
const getFinalWinnerIfDefined = (match) => {
    const winner = helpers.getWinner(match);
    if (!winner)
        throw Error('The final match does not have a winner.');
    return winner;
};

},{"./base/getter":1,"./helpers":8,"brackets-model":14}],8:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setExtraFields = exports.resetMatchResults = exports.setMatchResults = exports.getMatchStatus = exports.hasBye = exports.isMatchParticipantLocked = exports.isMatchUpdateLocked = exports.isMatchByeCompleted = exports.isMatchWinCompleted = exports.isMatchDrawCompleted = exports.isMatchResultCompleted = exports.isMatchForfeitCompleted = exports.isMatchStale = exports.isMatchOngoing = exports.isMatchCompleted = exports.isMatchStarted = exports.isMatchPending = exports.getOtherSide = exports.getSide = exports.isParticipantInMatch = exports.findPosition = exports.getMatchResult = exports.byeLoser = exports.byeWinnerToGrandFinal = exports.byeWinner = exports.getLoser = exports.getWinner = exports.toResultWithPosition = exports.toResult = exports.convertTBDtoBYE = exports.ensureNotTied = exports.ensureValidSize = exports.isPowerOfTwo = exports.fixSeeding = exports.ensureEquallySized = exports.ensureNoDuplicates = exports.ensureEvenSized = exports.makePairs = exports.setArraySize = exports.normalizeParticipant = exports.makeNormalizedIdMapping = exports.normalizeIds = exports.balanceByes = exports.makeGroups = exports.assertRoundRobin = exports.makeRoundRobinDistribution = exports.makeRoundRobinMatches = exports.splitByParity = exports.splitBy = exports.isDefined = void 0;
exports.getLowerBracketRoundCount = exports.getLoserOrdering = exports.getLoserCountFromWbForLbRound = exports.getLoserRoundMatchCount = exports.findLoserMatchNumber = exports.isDoubleEliminationNecessary = exports.getRoundPairCount = exports.getUpperBracketRoundCount = exports.isOrderingSupportedLoserBracket = exports.isOrderingSupportedUpperBracket = exports.ensureOrderingSupported = exports.getSeedCount = exports.getSeeds = exports.getChildGamesResults = exports.getUpdatedMatchResults = exports.getParentMatchResults = exports.setParentMatchCompleted = exports.transitionToMinor = exports.transitionToMajor = exports.isMinorRound = exports.isMajorRound = exports.uniqueBy = exports.getNonNull = exports.sortSeeding = exports.convertSlotsToSeeding = exports.convertMatchesToSeeding = exports.mapParticipantsToDatabase = exports.mapParticipantsIdsToDatabase = exports.mapParticipantsNamesToDatabase = exports.extractParticipantsFromSeeding = exports.isSeedingWithIds = exports.setForfeits = exports.setResults = exports.setCompleted = exports.getInferredResult = exports.setScores = exports.invertOpponents = exports.handleGivenStatus = exports.handleOpponentsInversion = exports.resetNextOpponent = exports.setNextOpponent = exports.getNextSideConsolationFinalDoubleElimination = exports.getNextSideLoserBracket = exports.getNextSide = exports.findParticipant = exports.getGrandFinalDecisiveMatch = exports.makeFinalStandings = exports.getLosers = exports.getOriginPosition = exports.getOpponentId = void 0;
exports.getFractionOfFinal = exports.getMatchLocation = exports.isFinalGroup = exports.isLoserBracket = exports.isWinnerBracket = exports.isRoundCompleted = exports.ensureNotRoundRobin = exports.isRoundRobin = exports.minScoreToWinBestOfX = exports.getNearestPowerOfTwo = exports.getDiagonalMatchNumber = void 0;
const brackets_model_1 = require("brackets-model");
const ordering_1 = require("./ordering");
/**
 * Checks whether a value is defined (i.e. not null nor undefined).
 *
 * @param value The value to check.
 */
function isDefined(value) {
    return value !== null && value !== undefined;
}
exports.isDefined = isDefined;
/**
 * Splits an array of objects based on their values at a given key.
 *
 * @param objects The array to split.
 * @param key The key of T.
 */
function splitBy(objects, key) {
    const map = {};
    for (const obj of objects) {
        const commonValue = obj[key];
        if (!map[commonValue])
            map[commonValue] = [];
        map[commonValue].push(obj);
    }
    return Object.values(map);
}
exports.splitBy = splitBy;
/**
 * Splits an array in two parts: one with even indices and the other with odd indices.
 *
 * @param array The array to split.
 */
function splitByParity(array) {
    return {
        even: array.filter((_, i) => i % 2 === 0),
        odd: array.filter((_, i) => i % 2 === 1),
    };
}
exports.splitByParity = splitByParity;
/**
 * Makes a list of rounds containing the matches of a round-robin group.
 *
 * @param participants The participants to distribute.
 * @param mode The round-robin mode.
 */
function makeRoundRobinMatches(participants, mode = 'simple') {
    const distribution = makeRoundRobinDistribution(participants);
    if (mode === 'simple')
        return distribution;
    // Reverse rounds and their content.
    const symmetry = distribution.map(round => [...round].reverse()).reverse();
    return [...distribution, ...symmetry];
}
exports.makeRoundRobinMatches = makeRoundRobinMatches;
/**
 * Distributes participants in rounds for a round-robin group.
 *
 * Conditions:
 * - Each participant plays each other once.
 * - Each participant plays once in each round.
 *
 * @param participants The participants to distribute.
 */
function makeRoundRobinDistribution(participants) {
    const n = participants.length;
    const n1 = n % 2 === 0 ? n : n + 1;
    const roundCount = n1 - 1;
    const matchPerRound = n1 / 2;
    const rounds = [];
    for (let roundId = 0; roundId < roundCount; roundId++) {
        const matches = [];
        for (let matchId = 0; matchId < matchPerRound; matchId++) {
            if (matchId === 0 && n % 2 === 1)
                continue;
            const opponentsIds = [
                (roundId - matchId - 1 + n1) % (n1 - 1),
                matchId === 0 ? n1 - 1 : (roundId + matchId) % (n1 - 1),
            ];
            matches.push([
                participants[opponentsIds[0]],
                participants[opponentsIds[1]],
            ]);
        }
        rounds.push(matches);
    }
    return rounds;
}
exports.makeRoundRobinDistribution = makeRoundRobinDistribution;
/**
 * A helper to assert our generated round-robin is correct.
 *
 * @param input The input seeding.
 * @param output The resulting distribution of seeds in groups.
 */
function assertRoundRobin(input, output) {
    const n = input.length;
    const matchPerRound = Math.floor(n / 2);
    const roundCount = n % 2 === 0 ? n - 1 : n;
    if (output.length !== roundCount)
        throw Error('Round count is wrong');
    if (!output.every(round => round.length === matchPerRound))
        throw Error('Not every round has the good number of matches');
    const checkAllOpponents = Object.fromEntries(input.map(element => [element, new Set()]));
    for (const round of output) {
        const checkUnique = new Set();
        for (const match of round) {
            if (match.length !== 2)
                throw Error('One match is not a pair');
            if (checkUnique.has(match[0]))
                throw Error('This team is already playing');
            checkUnique.add(match[0]);
            if (checkUnique.has(match[1]))
                throw Error('This team is already playing');
            checkUnique.add(match[1]);
            if (checkAllOpponents[match[0]].has(match[1]))
                throw Error('The team has already matched this team');
            checkAllOpponents[match[0]].add(match[1]);
            if (checkAllOpponents[match[1]].has(match[0]))
                throw Error('The team has already matched this team');
            checkAllOpponents[match[1]].add(match[0]);
        }
    }
}
exports.assertRoundRobin = assertRoundRobin;
/**
 * Distributes elements in groups of equal size.
 *
 * @param elements A list of elements to distribute in groups.
 * @param groupCount The group count.
 */
function makeGroups(elements, groupCount) {
    const groupSize = Math.ceil(elements.length / groupCount);
    const result = [];
    for (let i = 0; i < elements.length; i++) {
        if (i % groupSize === 0)
            result.push([]);
        result[result.length - 1].push(elements[i]);
    }
    return result;
}
exports.makeGroups = makeGroups;
/**
 * Balances BYEs to prevents having BYE against BYE in matches.
 *
 * @param seeding The seeding of the stage.
 * @param participantCount The number of participants in the stage.
 */
function balanceByes(seeding, participantCount) {
    seeding = seeding.filter(v => v !== null);
    participantCount = participantCount || getNearestPowerOfTwo(seeding.length);
    if (seeding.length < participantCount / 2) {
        const flat = seeding.flatMap(v => [v, null]);
        return setArraySize(flat, participantCount, null);
    }
    const nonNullCount = seeding.length;
    const nullCount = participantCount - nonNullCount;
    const againstEachOther = seeding.slice(0, nonNullCount - nullCount).filter((_, i) => i % 2 === 0).map((_, i) => [seeding[2 * i], seeding[2 * i + 1]]);
    const againstNull = seeding.slice(nonNullCount - nullCount, nonNullCount).map(v => [v, null]);
    const flat = [...againstEachOther.flat(), ...againstNull.flat()];
    return setArraySize(flat, participantCount, null);
}
exports.balanceByes = balanceByes;
/**
 * Normalizes IDs in a database.
 *
 * All IDs (and references to them) are remapped to consecutive IDs starting from 0.
 *
 * @param data Data to normalize.
 */
function normalizeIds(data) {
    const mappings = {
        participant: makeNormalizedIdMapping(data.participant),
        stage: makeNormalizedIdMapping(data.stage),
        group: makeNormalizedIdMapping(data.group),
        round: makeNormalizedIdMapping(data.round),
        match: makeNormalizedIdMapping(data.match),
        match_game: makeNormalizedIdMapping(data.match_game),
    };
    return {
        participant: data.participant.map(value => ({
            ...value,
            id: mappings.participant[value.id],
        })),
        stage: data.stage.map(value => ({
            ...value,
            id: mappings.stage[value.id],
        })),
        group: data.group.map(value => ({
            ...value,
            id: mappings.group[value.id],
            stage_id: mappings.stage[value.stage_id],
        })),
        round: data.round.map(value => ({
            ...value,
            id: mappings.round[value.id],
            stage_id: mappings.stage[value.stage_id],
            group_id: mappings.group[value.group_id],
        })),
        match: data.match.map(value => ({
            ...value,
            id: mappings.match[value.id],
            stage_id: mappings.stage[value.stage_id],
            group_id: mappings.group[value.group_id],
            round_id: mappings.round[value.round_id],
            opponent1: normalizeParticipant(value.opponent1, mappings.participant),
            opponent2: normalizeParticipant(value.opponent2, mappings.participant),
        })),
        match_game: data.match_game.map(value => ({
            ...value,
            id: mappings.match_game[value.id],
            stage_id: mappings.stage[value.stage_id],
            parent_id: mappings.match[value.parent_id],
            opponent1: normalizeParticipant(value.opponent1, mappings.participant),
            opponent2: normalizeParticipant(value.opponent2, mappings.participant),
        })),
    };
}
exports.normalizeIds = normalizeIds;
/**
 * Makes a mapping between old IDs and new normalized IDs.
 *
 * @param elements A list of elements with IDs.
 */
function makeNormalizedIdMapping(elements) {
    let currentId = 0;
    return elements.reduce((acc, current) => ({
        ...acc,
        [current.id]: currentId++,
    }), {});
}
exports.makeNormalizedIdMapping = makeNormalizedIdMapping;
/**
 * Apply a normalizing mapping to a participant.
 *
 * @param participant The participant.
 * @param mapping The mapping of IDs.
 */
function normalizeParticipant(participant, mapping) {
    if (participant === null)
        return null;
    return {
        ...participant,
        id: participant.id !== null ? mapping[participant.id] : null,
    };
}
exports.normalizeParticipant = normalizeParticipant;
/**
 * Sets the size of an array with a placeholder if the size is bigger.
 *
 * @param array The original array.
 * @param length The new length.
 * @param placeholder A placeholder to use to fill the empty space.
 */
function setArraySize(array, length, placeholder) {
    return Array.from({ length }, (_, i) => array[i] || placeholder);
}
exports.setArraySize = setArraySize;
/**
 * Makes pairs with each element and its next one.
 *
 * @example [1, 2, 3, 4] --> [[1, 2], [3, 4]]
 * @param array A list of elements.
 */
function makePairs(array) {
    return array.map((_, i) => (i % 2 === 0) ? [array[i], array[i + 1]] : []).filter((v) => v.length === 2);
}
exports.makePairs = makePairs;
/**
 * Ensures that a list of elements has an even size.
 *
 * @param array A list of elements.
 */
function ensureEvenSized(array) {
    if (array.length % 2 === 1)
        throw Error('Array size must be even.');
}
exports.ensureEvenSized = ensureEvenSized;
/**
 * Ensures there are no duplicates in a list of elements.
 *
 * @param array A list of elements.
 */
function ensureNoDuplicates(array) {
    const nonNull = getNonNull(array);
    const unique = nonNull.filter((item, index) => {
        const stringifiedItem = JSON.stringify(item);
        return nonNull.findIndex(obj => JSON.stringify(obj) === stringifiedItem) === index;
    });
    if (unique.length < nonNull.length)
        throw new Error('The seeding has a duplicate participant.');
}
exports.ensureNoDuplicates = ensureNoDuplicates;
/**
 * Ensures that two lists of elements have the same size.
 *
 * @param left The first list of elements.
 * @param right The second list of elements.
 */
function ensureEquallySized(left, right) {
    if (left.length !== right.length)
        throw Error('Arrays\' size must be equal.');
}
exports.ensureEquallySized = ensureEquallySized;
/**
 * Fixes the seeding by enlarging it if it's not complete.
 *
 * @param seeding The seeding of the stage.
 * @param participantCount The number of participants in the stage.
 */
function fixSeeding(seeding, participantCount) {
    if (seeding.length > participantCount)
        throw Error('The seeding has more participants than the size of the stage.');
    if (seeding.length < participantCount)
        return setArraySize(seeding, participantCount, null);
    return seeding;
}
exports.fixSeeding = fixSeeding;
/**
 * Indicates whether a number is a power of two.
 *
 * @param number The number to test.
 */
function isPowerOfTwo(number) {
    return Number.isInteger(Math.log2(number));
}
exports.isPowerOfTwo = isPowerOfTwo;
/**
 * Ensures that the participant count is valid.
 *
 * @param stageType Type of the stage to test.
 * @param participantCount The number to test.
 */
function ensureValidSize(stageType, participantCount) {
    if (participantCount === 0)
        throw Error('Impossible to create an empty stage. If you want an empty seeding, just set the size of the stage.');
    if (participantCount < 2)
        throw Error('Impossible to create a stage with less than 2 participants.');
    if (stageType === 'round_robin') {
        // Round robin supports any number of participants.
        return;
    }
    if (!isPowerOfTwo(participantCount))
        throw Error('The library only supports a participant count which is a power of two.');
}
exports.ensureValidSize = ensureValidSize;
/**
 * Ensures that a match scores aren't tied.
 *
 * @param scores Two numbers which are scores.
 */
function ensureNotTied(scores) {
    if (scores[0] === scores[1])
        throw Error(`${scores[0]} and ${scores[1]} are tied. It cannot be.`);
}
exports.ensureNotTied = ensureNotTied;
/**
 * Converts a TBD to a BYE.
 *
 * @param slot The slot to convert.
 */
function convertTBDtoBYE(slot) {
    if (slot === null)
        return null; // Already a BYE.
    if ((slot === null || slot === void 0 ? void 0 : slot.id) === null)
        return null; // It's a TBD: make it a BYE.
    return slot; // It's a determined participant.
}
exports.convertTBDtoBYE = convertTBDtoBYE;
/**
 * Converts a participant slot to a result stored in storage.
 *
 * @param slot A participant slot.
 */
function toResult(slot) {
    return slot && {
        id: slot.id,
    };
}
exports.toResult = toResult;
/**
 * Converts a participant slot to a result stored in storage, with the position the participant is coming from.
 *
 * @param slot A participant slot.
 */
function toResultWithPosition(slot) {
    return slot && {
        id: slot.id,
        position: slot.position,
    };
}
exports.toResultWithPosition = toResultWithPosition;
/**
 * Returns the winner of a match.
 *
 * @param match The match.
 */
function getWinner(match) {
    const winnerSide = getMatchResult(match);
    if (!winnerSide)
        return null;
    return match[winnerSide];
}
exports.getWinner = getWinner;
/**
 * Returns the loser of a match.
 *
 * @param match The match.
 */
function getLoser(match) {
    const winnerSide = getMatchResult(match);
    if (!winnerSide)
        return null;
    return match[getOtherSide(winnerSide)];
}
exports.getLoser = getLoser;
/**
 * Returns the pre-computed winner for a match because of BYEs.
 *
 * @param opponents Two opponents.
 */
function byeWinner(opponents) {
    if (opponents[0] === null && opponents[1] === null) // Double BYE.
        return null; // BYE.
    if (opponents[0] === null && opponents[1] !== null) // opponent1 BYE.
        return { id: opponents[1].id }; // opponent2.
    if (opponents[0] !== null && opponents[1] === null) // opponent2 BYE.
        return { id: opponents[0].id }; // opponent1.
    return { id: null }; // Normal.
}
exports.byeWinner = byeWinner;
/**
 * Returns the pre-computed winner for a match because of BYEs in a lower bracket.
 *
 * @param opponents Two opponents.
 */
function byeWinnerToGrandFinal(opponents) {
    const winner = byeWinner(opponents);
    if (winner)
        winner.position = 1;
    return winner;
}
exports.byeWinnerToGrandFinal = byeWinnerToGrandFinal;
/**
 * Returns the pre-computed loser for a match because of BYEs.
 *
 * Only used for loser bracket.
 *
 * @param opponents Two opponents.
 * @param index The index of the duel in the round.
 */
function byeLoser(opponents, index) {
    if (opponents[0] === null || opponents[1] === null) // At least one BYE.
        return null; // BYE.
    return { id: null, position: index + 1 }; // Normal.
}
exports.byeLoser = byeLoser;
/**
 * Returns the winner side or `null` if no winner.
 *
 * @param match A match's results.
 */
function getMatchResult(match) {
    var _a, _b;
    if (!isMatchCompleted(match))
        return null;
    if (isMatchDrawCompleted(match))
        return null;
    if (match.opponent1 === null && match.opponent2 === null)
        return null;
    let winner = null;
    if (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.result) === 'win' || match.opponent2 === null || match.opponent2.forfeit)
        winner = 'opponent1';
    if (((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.result) === 'win' || match.opponent1 === null || match.opponent1.forfeit) {
        if (winner !== null)
            throw Error('There are two winners.');
        winner = 'opponent2';
    }
    return winner;
}
exports.getMatchResult = getMatchResult;
/**
 * Finds a position in a list of matches.
 *
 * @param matches A list of matches to search into.
 * @param position The position to find.
 */
function findPosition(matches, position) {
    var _a, _b;
    for (const match of matches) {
        if (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.position) === position)
            return match.opponent1;
        if (((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.position) === position)
            return match.opponent2;
    }
    return null;
}
exports.findPosition = findPosition;
/**
 * Checks if a participant is involved in a given match.
 *
 * @param match A match.
 * @param participantId ID of a participant.
 */
function isParticipantInMatch(match, participantId) {
    return [match.opponent1, match.opponent2].some(m => (m === null || m === void 0 ? void 0 : m.id) === participantId);
}
exports.isParticipantInMatch = isParticipantInMatch;
/**
 * Gets the side where the winner of the given match will go in the next match.
 *
 * @param matchNumber Number of the match.
 */
function getSide(matchNumber) {
    return matchNumber % 2 === 1 ? 'opponent1' : 'opponent2';
}
exports.getSide = getSide;
/**
 * Gets the other side of a match.
 *
 * @param side The side that we don't want.
 */
function getOtherSide(side) {
    return side === 'opponent1' ? 'opponent2' : 'opponent1';
}
exports.getOtherSide = getOtherSide;
/**
 * Checks if a match is pending (i.e. locked or waiting).
 *
 * [Locked > Waiting] > Ready > Running > Completed > Archived
 *
 * @param match Partial match results.
 */
function isMatchPending(match) {
    var _a, _b;
    return !((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.id) || !((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.id); // At least one BYE or TBD
}
exports.isMatchPending = isMatchPending;
/**
 * Checks if a match is started.
 *
 * Note: this is score-based. A completed or archived match is seen as "started" as well.
 *
 * Locked > Waiting > Ready > [Running > Completed > Archived]
 *
 * @param match Partial match results.
 */
function isMatchStarted(match) {
    var _a, _b;
    return ((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.score) !== undefined || ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.score) !== undefined;
}
exports.isMatchStarted = isMatchStarted;
/**
 * Checks if a match is completed (based on BYEs, forfeit or result).
 *
 * Note: archived matches are not seen as completed by this helper.
 *
 * Locked > Waiting > Ready > Running > [Completed] > Archived
 *
 * @param match Partial match results.
 */
function isMatchCompleted(match) {
    return isMatchByeCompleted(match) || isMatchForfeitCompleted(match) || isMatchResultCompleted(match);
}
exports.isMatchCompleted = isMatchCompleted;
/**
 * Checks if a match is ongoing (i.e. ready or running).
 *
 * Locked > Waiting > [Ready > Running] > Completed > Archived
 *
 * @param match Partial match results.
 */
function isMatchOngoing(match) {
    return [brackets_model_1.Status.Ready, brackets_model_1.Status.Running].includes(match.status);
}
exports.isMatchOngoing = isMatchOngoing;
/**
 * Checks if a match is stale (i.e. it should not change anymore).
 *
 * [Locked - BYE] > Waiting > Ready > Running > [Completed > Archived]
 *
 * @param match Partial match results.
 */
function isMatchStale(match) {
    return match.status >= brackets_model_1.Status.Completed || isMatchByeCompleted(match);
}
exports.isMatchStale = isMatchStale;
/**
 * Checks if a match is completed because of a forfeit.
 *
 * @param match Partial match results.
 */
function isMatchForfeitCompleted(match) {
    var _a, _b;
    return ((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.forfeit) !== undefined || ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.forfeit) !== undefined;
}
exports.isMatchForfeitCompleted = isMatchForfeitCompleted;
/**
 * Checks if a match is completed because of a either a draw or a win.
 *
 * @param match Partial match results.
 */
function isMatchResultCompleted(match) {
    return isMatchDrawCompleted(match) || isMatchWinCompleted(match);
}
exports.isMatchResultCompleted = isMatchResultCompleted;
/**
 * Checks if a match is completed because of a draw.
 *
 * @param match Partial match results.
 */
function isMatchDrawCompleted(match) {
    var _a, _b;
    return ((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.result) === 'draw' && ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.result) === 'draw';
}
exports.isMatchDrawCompleted = isMatchDrawCompleted;
/**
 * Checks if a match is completed because of a win.
 *
 * @param match Partial match results.
 */
function isMatchWinCompleted(match) {
    var _a, _b, _c, _d;
    return ((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.result) === 'win' || ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.result) === 'win'
        || ((_c = match.opponent1) === null || _c === void 0 ? void 0 : _c.result) === 'loss' || ((_d = match.opponent2) === null || _d === void 0 ? void 0 : _d.result) === 'loss';
}
exports.isMatchWinCompleted = isMatchWinCompleted;
/**
 * Checks if a match is completed because of at least one BYE.
 *
 * A match "BYE vs. TBD" isn't considered completed yet.
 *
 * @param match Partial match results.
 */
function isMatchByeCompleted(match) {
    var _a, _b;
    return (match.opponent1 === null && ((_a = match.opponent2) === null || _a === void 0 ? void 0 : _a.id) !== null) // BYE vs. someone
        || (match.opponent2 === null && ((_b = match.opponent1) === null || _b === void 0 ? void 0 : _b.id) !== null) // someone vs. BYE
        || (match.opponent1 === null && match.opponent2 === null); // BYE vs. BYE
}
exports.isMatchByeCompleted = isMatchByeCompleted;
/**
 * Checks if a match's results can't be updated.
 *
 * @param match The match to check.
 */
function isMatchUpdateLocked(match) {
    return match.status === brackets_model_1.Status.Locked || match.status === brackets_model_1.Status.Waiting || match.status === brackets_model_1.Status.Archived || isMatchByeCompleted(match);
}
exports.isMatchUpdateLocked = isMatchUpdateLocked;
/**
 * Checks if a match's participants can't be updated.
 *
 * @param match The match to check.
 */
function isMatchParticipantLocked(match) {
    return match.status >= brackets_model_1.Status.Running;
}
exports.isMatchParticipantLocked = isMatchParticipantLocked;
/**
 * Indicates whether a match has at least one BYE or not.
 *
 * @param match Partial match results.
 */
function hasBye(match) {
    return match.opponent1 === null || match.opponent2 === null;
}
exports.hasBye = hasBye;
/**
 * Returns the status of a match based on information about it.
 *
 * @param arg The opponents or partial results of the match.
 */
function getMatchStatus(arg) {
    var _a, _b, _c, _d;
    const match = Array.isArray(arg) ? {
        opponent1: arg[0],
        opponent2: arg[1],
    } : arg;
    if (hasBye(match)) // At least one BYE.
        return brackets_model_1.Status.Locked;
    if (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.id) === null && ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.id) === null) // Two TBD opponents.
        return brackets_model_1.Status.Locked;
    if (((_c = match.opponent1) === null || _c === void 0 ? void 0 : _c.id) === null || ((_d = match.opponent2) === null || _d === void 0 ? void 0 : _d.id) === null) // One TBD opponent.
        return brackets_model_1.Status.Waiting;
    if (isMatchCompleted(match))
        return brackets_model_1.Status.Completed;
    if (isMatchStarted(match))
        return brackets_model_1.Status.Running;
    return brackets_model_1.Status.Ready;
}
exports.getMatchStatus = getMatchStatus;
/**
 * Updates a match results based on an input.
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 * @param inRoundRobin Indicates whether the match is in a round-robin stage.
 */
function setMatchResults(stored, match, inRoundRobin) {
    var _a, _b;
    handleGivenStatus(stored, match);
    if (!inRoundRobin && (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.result) === 'draw' || ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.result) === 'draw'))
        throw Error('Having a draw is forbidden in an elimination tournament.');
    const completed = isMatchCompleted(match);
    const currentlyCompleted = isMatchCompleted(stored);
    setExtraFields(stored, match);
    handleOpponentsInversion(stored, match);
    const statusChanged = setScores(stored, match);
    if (completed && currentlyCompleted) {
        // Ensure everything is good.
        setCompleted(stored, match, inRoundRobin);
        return { statusChanged: false, resultChanged: true };
    }
    if (completed && !currentlyCompleted) {
        setCompleted(stored, match, inRoundRobin);
        return { statusChanged: true, resultChanged: true };
    }
    if (!completed && currentlyCompleted) {
        resetMatchResults(stored);
        return { statusChanged: true, resultChanged: true };
    }
    return { statusChanged, resultChanged: false };
}
exports.setMatchResults = setMatchResults;
/**
 * Resets the results of a match. (status, forfeit, result)
 *
 * @param stored A reference to what will be updated in the storage.
 */
function resetMatchResults(stored) {
    if (stored.opponent1) {
        stored.opponent1.forfeit = undefined;
        stored.opponent1.result = undefined;
    }
    if (stored.opponent2) {
        stored.opponent2.forfeit = undefined;
        stored.opponent2.result = undefined;
    }
    stored.status = getMatchStatus(stored);
}
exports.resetMatchResults = resetMatchResults;
/**
 * Passes user-defined extra fields to the stored match.
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 */
function setExtraFields(stored, match) {
    const partialAssign = (target, update, ignoredKeys) => {
        if (!target || !update)
            return;
        const retainedKeys = Object.keys(update).filter((key) => !ignoredKeys.includes(key));
        retainedKeys.forEach(key => {
            target[key] = update[key];
        });
    };
    const ignoredKeys = [
        'id',
        'number',
        'stage_id',
        'group_id',
        'round_id',
        'status',
        'opponent1',
        'opponent2',
        'child_count',
        'parent_id',
    ];
    const ignoredOpponentKeys = [
        'id',
        'score',
        'position',
        'forfeit',
        'result',
    ];
    partialAssign(stored, match, ignoredKeys);
    partialAssign(stored.opponent1, match.opponent1, ignoredOpponentKeys);
    partialAssign(stored.opponent2, match.opponent2, ignoredOpponentKeys);
}
exports.setExtraFields = setExtraFields;
/**
 * Gets the id of the opponent at the given side of the given match.
 *
 * @param match The match to get the opponent from.
 * @param side The side where to get the opponent from.
 */
function getOpponentId(match, side) {
    const opponent = match[side];
    return opponent && opponent.id;
}
exports.getOpponentId = getOpponentId;
/**
 * Gets the origin position of a side of a match.
 *
 * @param match The match.
 * @param side The side.
 */
function getOriginPosition(match, side) {
    var _a;
    const matchNumber = (_a = match[side]) === null || _a === void 0 ? void 0 : _a.position;
    if (matchNumber === undefined)
        throw Error('Position is undefined.');
    return matchNumber;
}
exports.getOriginPosition = getOriginPosition;
/**
 * Returns every loser in a list of matches.
 *
 * @param participants The list of participants.
 * @param matches A list of matches to get losers of.
 */
function getLosers(participants, matches) {
    const losers = [];
    let currentRound = null;
    let roundIndex = -1;
    for (const match of matches) {
        if (match.round_id !== currentRound) {
            currentRound = match.round_id;
            roundIndex++;
            losers[roundIndex] = [];
        }
        const loser = getLoser(match);
        if (loser === null)
            continue;
        losers[roundIndex].push(findParticipant(participants, loser));
    }
    return losers;
}
exports.getLosers = getLosers;
/**
 * Makes final standings based on participants grouped by ranking.
 *
 * @param grouped A list of participants grouped by ranking.
 */
function makeFinalStandings(grouped) {
    const standings = [];
    let rank = 1;
    for (const group of grouped) {
        for (const participant of group) {
            standings.push({
                id: participant.id,
                name: participant.name,
                rank,
            });
        }
        rank++;
    }
    return standings;
}
exports.makeFinalStandings = makeFinalStandings;
/**
 * Returns the decisive match of a Grand Final.
 *
 * @param type The type of Grand Final.
 * @param matches The matches in the Grand Final.
 */
function getGrandFinalDecisiveMatch(type, matches) {
    if (type === 'simple')
        return matches[0];
    if (type === 'double') {
        const result = getMatchResult(matches[0]);
        if (result === 'opponent2')
            return matches[1];
        return matches[0];
    }
    throw Error('The Grand Final is disabled.');
}
exports.getGrandFinalDecisiveMatch = getGrandFinalDecisiveMatch;
/**
 * Finds a participant in a list.
 *
 * @param participants The list of participants.
 * @param slot The slot of the participant to find.
 */
function findParticipant(participants, slot) {
    if (!slot)
        throw Error('Cannot find a BYE participant.');
    const participant = participants.find(participant => participant.id === (slot === null || slot === void 0 ? void 0 : slot.id));
    if (!participant)
        throw Error('Participant not found.');
    return participant;
}
exports.findParticipant = findParticipant;
/**
 * Gets the side the winner of the current match will go to in the next match.
 *
 * @param matchNumber Number of the current match.
 * @param roundNumber Number of the current round.
 * @param roundCount Count of rounds.
 * @param matchLocation Location of the current match.
 */
function getNextSide(matchNumber, roundNumber, roundCount, matchLocation) {
    // The nextSide comes from the same bracket.
    if (matchLocation === 'loser_bracket' && roundNumber % 2 === 1)
        return 'opponent2';
    // The nextSide comes from the loser bracket to the final group.
    if (matchLocation === 'loser_bracket' && roundNumber === roundCount)
        return 'opponent2';
    return getSide(matchNumber);
}
exports.getNextSide = getNextSide;
/**
 * Gets the side the winner of the current match in loser bracket will go in the next match.
 *
 * @param matchNumber Number of the match.
 * @param nextMatch The next match.
 * @param roundNumber Number of the current round.
 */
function getNextSideLoserBracket(matchNumber, nextMatch, roundNumber) {
    var _a;
    // The nextSide comes from the WB.
    if (roundNumber > 1)
        return 'opponent1';
    // The nextSide comes from the WB round 1. 
    if (((_a = nextMatch.opponent1) === null || _a === void 0 ? void 0 : _a.position) === matchNumber)
        return 'opponent1';
    return 'opponent2';
}
exports.getNextSideLoserBracket = getNextSideLoserBracket;
/**
 * Gets the side the loser of the current match in loser bracket will go in the next match.
 *
 * @param roundNumber Number of the current round.
 */
function getNextSideConsolationFinalDoubleElimination(roundNumber) {
    return isMajorRound(roundNumber) ? 'opponent1' : 'opponent2';
}
exports.getNextSideConsolationFinalDoubleElimination = getNextSideConsolationFinalDoubleElimination;
/**
 * Sets an opponent in the next match he has to go.
 *
 * @param nextMatch A match which follows the current one.
 * @param nextSide The side the opponent will be on in the next match.
 * @param match The current match.
 * @param currentSide The side the opponent is currently on.
 */
function setNextOpponent(nextMatch, nextSide, match, currentSide) {
    var _a;
    nextMatch[nextSide] = match[currentSide] && {
        id: getOpponentId(match, currentSide),
        position: (_a = nextMatch[nextSide]) === null || _a === void 0 ? void 0 : _a.position, // Keep position.
    };
    nextMatch.status = getMatchStatus(nextMatch);
}
exports.setNextOpponent = setNextOpponent;
/**
 * Resets an opponent in the match following the current one.
 *
 * @param nextMatch A match which follows the current one.
 * @param nextSide The side the opponent will be on in the next match.
 */
function resetNextOpponent(nextMatch, nextSide) {
    var _a;
    nextMatch[nextSide] = nextMatch[nextSide] && {
        id: null,
        position: (_a = nextMatch[nextSide]) === null || _a === void 0 ? void 0 : _a.position, // Keep position.
    };
    nextMatch.status = brackets_model_1.Status.Locked;
}
exports.resetNextOpponent = resetNextOpponent;
/**
 * Inverts opponents if requested by the input.
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 */
function handleOpponentsInversion(stored, match) {
    var _a, _b, _c, _d;
    const id1 = (_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.id;
    const id2 = (_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.id;
    const storedId1 = (_c = stored.opponent1) === null || _c === void 0 ? void 0 : _c.id;
    const storedId2 = (_d = stored.opponent2) === null || _d === void 0 ? void 0 : _d.id;
    if (isDefined(id1) && id1 !== storedId1 && id1 !== storedId2)
        throw Error('The given opponent1 ID does not exist in this match.');
    if (isDefined(id2) && id2 !== storedId1 && id2 !== storedId2)
        throw Error('The given opponent2 ID does not exist in this match.');
    if (isDefined(id1) && id1 === storedId2 || isDefined(id2) && id2 === storedId1)
        invertOpponents(match);
}
exports.handleOpponentsInversion = handleOpponentsInversion;
/**
 * Sets the `result` of both opponents based on their scores.
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 */
function handleGivenStatus(stored, match) {
    var _a, _b, _c, _d;
    if (match.status === brackets_model_1.Status.Running) {
        (_a = stored.opponent1) === null || _a === void 0 ? true : delete _a.result;
        (_b = stored.opponent2) === null || _b === void 0 ? true : delete _b.result;
        stored.status = brackets_model_1.Status.Running;
    }
    else if (match.status === brackets_model_1.Status.Completed) {
        if (((_c = match.opponent1) === null || _c === void 0 ? void 0 : _c.score) === undefined || ((_d = match.opponent2) === null || _d === void 0 ? void 0 : _d.score) === undefined)
            return;
        if (match.opponent1.score > match.opponent2.score)
            match.opponent1.result = 'win';
        else if (match.opponent2.score > match.opponent1.score)
            match.opponent2.result = 'win';
        else {
            // This will throw in an elimination stage.
            match.opponent1.result = 'draw';
            match.opponent2.result = 'draw';
        }
        stored.status = brackets_model_1.Status.Completed;
    }
}
exports.handleGivenStatus = handleGivenStatus;
/**
 * Inverts `opponent1` and `opponent2` in a match.
 *
 * @param match A match to update.
 */
function invertOpponents(match) {
    [match.opponent1, match.opponent2] = [match.opponent2, match.opponent1];
}
exports.invertOpponents = invertOpponents;
/**
 * Updates the scores of a match.
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 * @returns `true` if the status of the match changed, `false` otherwise.
 */
function setScores(stored, match) {
    var _a, _b, _c, _d;
    // Skip if no score update.
    if (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.score) === ((_b = stored.opponent1) === null || _b === void 0 ? void 0 : _b.score) && ((_c = match.opponent2) === null || _c === void 0 ? void 0 : _c.score) === ((_d = stored.opponent2) === null || _d === void 0 ? void 0 : _d.score))
        return false;
    const oldStatus = stored.status;
    stored.status = brackets_model_1.Status.Running;
    if (match.opponent1 && stored.opponent1)
        stored.opponent1.score = match.opponent1.score;
    if (match.opponent2 && stored.opponent2)
        stored.opponent2.score = match.opponent2.score;
    return stored.status !== oldStatus;
}
exports.setScores = setScores;
/**
 * Infers the win result based on BYEs.
 *
 * @param opponent1 Opponent 1.
 * @param opponent2 Opponent 2.
 */
function getInferredResult(opponent1, opponent2) {
    if (opponent1 && !opponent2) // someone vs. BYE
        return { opponent1: { ...opponent1, result: 'win' }, opponent2: null };
    if (!opponent1 && opponent2) // BYE vs. someone
        return { opponent1: null, opponent2: { ...opponent2, result: 'win' } };
    return { opponent1, opponent2 }; // Do nothing if both BYE or both someone
}
exports.getInferredResult = getInferredResult;
/**
 * Completes a match and handles results and forfeits.
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 * @param inRoundRobin Indicates whether the match is in a round-robin stage.
 */
function setCompleted(stored, match, inRoundRobin) {
    stored.status = brackets_model_1.Status.Completed;
    setResults(stored, match, 'win', 'loss', inRoundRobin);
    setResults(stored, match, 'loss', 'win', inRoundRobin);
    setResults(stored, match, 'draw', 'draw', inRoundRobin);
    const { opponent1, opponent2 } = getInferredResult(stored.opponent1, stored.opponent2);
    stored.opponent1 = opponent1;
    stored.opponent2 = opponent2;
    setForfeits(stored, match);
}
exports.setCompleted = setCompleted;
/**
 * Enforces the symmetry between opponents.
 *
 * Sets an opponent's result to something, based on the result on the other opponent.
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 * @param check A result to check in each opponent.
 * @param change A result to set in each other opponent if `check` is correct.
 * @param inRoundRobin Indicates whether the match is in a round-robin stage.
 */
function setResults(stored, match, check, change, inRoundRobin) {
    var _a, _b;
    if (match.opponent1 && match.opponent2) {
        if (match.opponent1.result === 'win' && match.opponent2.result === 'win')
            throw Error('There are two winners.');
        if (match.opponent1.result === 'loss' && match.opponent2.result === 'loss')
            throw Error('There are two losers.');
        if (!inRoundRobin && match.opponent1.forfeit === true && match.opponent2.forfeit === true)
            throw Error('There are two forfeits.');
    }
    if (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.result) === check) {
        if (stored.opponent1)
            stored.opponent1.result = check;
        else
            stored.opponent1 = { id: null, result: check };
        if (stored.opponent2)
            stored.opponent2.result = change;
        else
            stored.opponent2 = { id: null, result: change };
    }
    if (((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.result) === check) {
        if (stored.opponent2)
            stored.opponent2.result = check;
        else
            stored.opponent2 = { id: null, result: check };
        if (stored.opponent1)
            stored.opponent1.result = change;
        else
            stored.opponent1 = { id: null, result: change };
    }
}
exports.setResults = setResults;
/**
 * Sets forfeits for each opponent (if needed).
 *
 * @param stored A reference to what will be updated in the storage.
 * @param match Input of the update.
 */
function setForfeits(stored, match) {
    var _a, _b, _c, _d;
    if (((_a = match.opponent1) === null || _a === void 0 ? void 0 : _a.forfeit) === true && ((_b = match.opponent2) === null || _b === void 0 ? void 0 : _b.forfeit) === true) {
        if (stored.opponent1)
            stored.opponent1.forfeit = true;
        if (stored.opponent2)
            stored.opponent2.forfeit = true;
        // Don't set any result (win/draw/loss) with a double forfeit 
        // so that it doesn't count any point in the ranking.
        return;
    }
    if (((_c = match.opponent1) === null || _c === void 0 ? void 0 : _c.forfeit) === true) {
        if (stored.opponent1)
            stored.opponent1.forfeit = true;
        if (stored.opponent2)
            stored.opponent2.result = 'win';
        else
            stored.opponent2 = { id: null, result: 'win' };
    }
    if (((_d = match.opponent2) === null || _d === void 0 ? void 0 : _d.forfeit) === true) {
        if (stored.opponent2)
            stored.opponent2.forfeit = true;
        if (stored.opponent1)
            stored.opponent1.result = 'win';
        else
            stored.opponent1 = { id: null, result: 'win' };
    }
}
exports.setForfeits = setForfeits;
/**
 * Indicates if a seeding is filled with participants' IDs.
 *
 * @param seeding The seeding.
 */
function isSeedingWithIds(seeding) {
    return seeding.some(value => typeof value === 'number');
}
exports.isSeedingWithIds = isSeedingWithIds;
/**
 * Extracts participants from a seeding, without the BYEs.
 *
 * @param tournamentId ID of the tournament.
 * @param seeding The seeding (no IDs).
 */
function extractParticipantsFromSeeding(tournamentId, seeding) {
    const withoutByes = seeding.filter((name) => name !== null);
    const participants = withoutByes.map((item) => {
        if (typeof item === 'string') {
            return {
                tournament_id: tournamentId,
                name: item,
            };
        }
        return {
            ...item,
            tournament_id: tournamentId,
            name: item.name,
        };
    });
    return participants;
}
exports.extractParticipantsFromSeeding = extractParticipantsFromSeeding;
/**
 * Returns participant slots mapped to the instances stored in the database thanks to their name.
 *
 * @param seeding The seeding.
 * @param database The participants stored in the database.
 * @param positions An optional list of positions (seeds) for a manual ordering.
 */
function mapParticipantsNamesToDatabase(seeding, database, positions) {
    return mapParticipantsToDatabase('name', seeding, database, positions);
}
exports.mapParticipantsNamesToDatabase = mapParticipantsNamesToDatabase;
/**
 * Returns participant slots mapped to the instances stored in the database thanks to their id.
 *
 * @param seeding The seeding.
 * @param database The participants stored in the database.
 * @param positions An optional list of positions (seeds) for a manual ordering.
 */
function mapParticipantsIdsToDatabase(seeding, database, positions) {
    return mapParticipantsToDatabase('id', seeding, database, positions);
}
exports.mapParticipantsIdsToDatabase = mapParticipantsIdsToDatabase;
/**
 * Returns participant slots mapped to the instances stored in the database thanks to a property of theirs.
 *
 * @param prop The property to search participants with.
 * @param seeding The seeding.
 * @param database The participants stored in the database.
 * @param positions An optional list of positions (seeds) for a manual ordering.
 */
function mapParticipantsToDatabase(prop, seeding, database, positions) {
    const slots = seeding.map((slot, i) => {
        if (slot === null)
            return null; // BYE.
        const found = database.find(participant => typeof slot === 'object' ? participant[prop] === slot[prop] : participant[prop] === slot);
        if (!found)
            throw Error(`Participant ${prop} not found in database.`);
        return { id: found.id, position: i + 1 };
    });
    if (!positions)
        return slots;
    if (positions.length !== slots.length)
        throw Error('Not enough seeds in at least one group of the manual ordering.');
    return positions.map(position => slots[position - 1]); // Because `position` is `i + 1`.
}
exports.mapParticipantsToDatabase = mapParticipantsToDatabase;
/**
 * Converts a list of matches to a seeding.
 *
 * @param matches The input matches.
 */
function convertMatchesToSeeding(matches) {
    const flattened = [].concat(...matches.map(match => [match.opponent1, match.opponent2]));
    return sortSeeding(flattened);
}
exports.convertMatchesToSeeding = convertMatchesToSeeding;
/**
 * Converts a list of slots to an input seeding.
 *
 * @param slots The slots to convert.
 */
function convertSlotsToSeeding(slots) {
    return slots.map(slot => {
        if (slot === null || slot.id === null)
            return null; // BYE or TBD.
        return slot.id; // Let's return the ID instead of the name to be sure we keep the same reference.
    });
}
exports.convertSlotsToSeeding = convertSlotsToSeeding;
/**
 * Sorts the seeding with the BYEs in the correct position.
 *
 * @param slots A list of slots to sort.
 */
function sortSeeding(slots) {
    const withoutByes = slots.filter(v => v !== null);
    // a and b are not null because of the filter.
    // The slots are from seeding slots, thus they have a position.
    withoutByes.sort((a, b) => a.position - b.position);
    if (withoutByes.length === slots.length)
        return withoutByes;
    // Same for v and position.
    const placed = Object.fromEntries(withoutByes.map(v => [v.position - 1, v]));
    const sortedWithByes = Array.from({ length: slots.length }, (_, i) => placed[i] || null);
    return sortedWithByes;
}
exports.sortSeeding = sortSeeding;
/**
 * Returns only the non null elements.
 *
 * @param array The array to process.
 */
function getNonNull(array) {
    // Use a TS type guard to exclude null from the resulting type.
    const nonNull = array.filter((element) => element !== null);
    return nonNull;
}
exports.getNonNull = getNonNull;
/**
 * Returns a list of objects which have unique values of a specific key.
 *
 * @param array The array to process.
 * @param key The key to filter by.
 */
function uniqueBy(array, key) {
    const seen = new Set();
    return array.filter(item => {
        const value = key(item);
        if (!value)
            return true;
        if (seen.has(value))
            return false;
        seen.add(value);
        return true;
    });
}
exports.uniqueBy = uniqueBy;
/**
 * Indicates whether the loser bracket round is major.
 *
 * @param roundNumber Number of the round.
 */
function isMajorRound(roundNumber) {
    return roundNumber % 2 === 1;
}
exports.isMajorRound = isMajorRound;
/**
 * Indicates whether the loser bracket round is minor.
 *
 * @param roundNumber Number of the round.
 */
function isMinorRound(roundNumber) {
    return !isMajorRound(roundNumber);
}
exports.isMinorRound = isMinorRound;
/**
 * Makes the transition to a major round for duels of the previous round. The duel count is divided by 2.
 *
 * @param previousDuels The previous duels to transition from.
 */
function transitionToMajor(previousDuels) {
    const currentDuelCount = previousDuels.length / 2;
    const currentDuels = [];
    for (let duelIndex = 0; duelIndex < currentDuelCount; duelIndex++) {
        const prevDuelId = duelIndex * 2;
        currentDuels.push([
            byeWinner(previousDuels[prevDuelId]),
            byeWinner(previousDuels[prevDuelId + 1]),
        ]);
    }
    return currentDuels;
}
exports.transitionToMajor = transitionToMajor;
/**
 * Makes the transition to a minor round for duels of the previous round. The duel count stays the same.
 *
 * @param previousDuels The previous duels to transition from.
 * @param losers Losers from the previous major round.
 * @param method The ordering method for the losers.
 */
function transitionToMinor(previousDuels, losers, method) {
    const orderedLosers = method ? ordering_1.ordering[method](losers) : losers;
    const currentDuelCount = previousDuels.length;
    const currentDuels = [];
    for (let duelIndex = 0; duelIndex < currentDuelCount; duelIndex++) {
        const prevDuelId = duelIndex;
        currentDuels.push([
            orderedLosers[prevDuelId],
            byeWinner(previousDuels[prevDuelId]),
        ]);
    }
    return currentDuels;
}
exports.transitionToMinor = transitionToMinor;
/**
 * Sets the parent match to a completed status if all its child games are completed.
 *
 * @param parent The partial parent match to update.
 * @param childCount Child count of this parent match.
 * @param inRoundRobin Indicates whether the parent match is in a round-robin stage.
 */
function setParentMatchCompleted(parent, childCount, inRoundRobin) {
    var _a, _b;
    if (((_a = parent.opponent1) === null || _a === void 0 ? void 0 : _a.score) === undefined || ((_b = parent.opponent2) === null || _b === void 0 ? void 0 : _b.score) === undefined)
        throw Error('Either opponent1, opponent2 or their scores are falsy.');
    const minToWin = minScoreToWinBestOfX(childCount);
    if (parent.opponent1.score >= minToWin) {
        parent.opponent1.result = 'win';
        return;
    }
    if (parent.opponent2.score >= minToWin) {
        parent.opponent2.result = 'win';
        return;
    }
    if (parent.opponent1.score === parent.opponent2.score && parent.opponent1.score + parent.opponent2.score > childCount - 1) {
        if (inRoundRobin) {
            parent.opponent1.result = 'draw';
            parent.opponent2.result = 'draw';
            return;
        }
        throw Error('Match games result in a tie for the parent match.');
    }
}
exports.setParentMatchCompleted = setParentMatchCompleted;
/**
 * Returns a parent match results based on its child games scores.
 *
 * @param storedParent The parent match stored in the database.
 * @param scores The scores of the match child games.
 */
function getParentMatchResults(storedParent, scores) {
    return {
        opponent1: {
            id: storedParent.opponent1 && storedParent.opponent1.id,
            score: scores.opponent1,
        },
        opponent2: {
            id: storedParent.opponent2 && storedParent.opponent2.id,
            score: scores.opponent2,
        },
    };
}
exports.getParentMatchResults = getParentMatchResults;
/**
 * Gets the values which need to be updated in a match when it's updated on insertion.
 *
 * @param match The up to date match.
 * @param existing The base match.
 * @param enableByes Whether to use BYEs or TBDs for `null` values in an input seeding.
 */
function getUpdatedMatchResults(match, existing, enableByes) {
    return {
        ...existing,
        ...match,
        ...(enableByes ? {
            opponent1: match.opponent1 === null ? null : { ...existing.opponent1, ...match.opponent1 },
            opponent2: match.opponent2 === null ? null : { ...existing.opponent2, ...match.opponent2 },
        } : {
            opponent1: match.opponent1 === null ? { id: null } : { ...existing.opponent1, ...match.opponent1 },
            opponent2: match.opponent2 === null ? { id: null } : { ...existing.opponent2, ...match.opponent2 },
        }),
    };
}
exports.getUpdatedMatchResults = getUpdatedMatchResults;
/**
 * Calculates the score of a parent match based on its child games.
 *
 * @param games The child games to process.
 */
function getChildGamesResults(games) {
    const scores = {
        opponent1: 0,
        opponent2: 0,
    };
    for (const game of games) {
        const result = getMatchResult(game);
        if (result === 'opponent1')
            scores.opponent1++;
        else if (result === 'opponent2')
            scores.opponent2++;
    }
    return scores;
}
exports.getChildGamesResults = getChildGamesResults;
/**
 * Gets the default list of seeds for a round's matches.
 *
 * @param inLoserBracket Whether the match is in the loser bracket.
 * @param roundNumber The number of the current round.
 * @param roundCountLB The count of rounds in loser bracket.
 * @param matchCount The count of matches in the round.
 */
function getSeeds(inLoserBracket, roundNumber, roundCountLB, matchCount) {
    const seedCount = getSeedCount(inLoserBracket, roundNumber, roundCountLB, matchCount);
    return Array.from({ length: seedCount }, (_, i) => i + 1);
}
exports.getSeeds = getSeeds;
/**
 * Gets the number of seeds for a round's matches.
 *
 * @param inLoserBracket Whether the match is in the loser bracket.
 * @param roundNumber The number of the current round.
 * @param roundCountLB The count of rounds in loser bracket.
 * @param matchCount The count of matches in the round.
 */
function getSeedCount(inLoserBracket, roundNumber, roundCountLB, matchCount) {
    ensureOrderingSupported(inLoserBracket, roundNumber, roundCountLB);
    return roundNumber === 1 ?
        matchCount * 2 : // Two per match for upper or lower bracket round 1.
        matchCount; // One per match for loser bracket minor rounds.
}
exports.getSeedCount = getSeedCount;
/**
 * Throws if the ordering is not supported on the given round number.
 *
 * @param inLoserBracket Whether the match is in the loser bracket.
 * @param roundNumber The number of the round.
 * @param roundCountLB The count of rounds in loser bracket.
 */
function ensureOrderingSupported(inLoserBracket, roundNumber, roundCountLB) {
    if (inLoserBracket && !isOrderingSupportedLoserBracket(roundNumber, roundCountLB))
        throw Error('This round does not support ordering.');
    if (!inLoserBracket && !isOrderingSupportedUpperBracket(roundNumber))
        throw Error('This round does not support ordering.');
}
exports.ensureOrderingSupported = ensureOrderingSupported;
/**
 * Indicates whether the ordering is supported in upper bracket, given the round number.
 *
 * @param roundNumber The number of the round.
 */
function isOrderingSupportedUpperBracket(roundNumber) {
    return roundNumber === 1;
}
exports.isOrderingSupportedUpperBracket = isOrderingSupportedUpperBracket;
/**
 * Indicates whether the ordering is supported in loser bracket, given the round number.
 *
 * @param roundNumber The number of the round.
 * @param roundCount The count of rounds.
 */
function isOrderingSupportedLoserBracket(roundNumber, roundCount) {
    return roundNumber === 1 || (isMinorRound(roundNumber) && roundNumber < roundCount);
}
exports.isOrderingSupportedLoserBracket = isOrderingSupportedLoserBracket;
/**
 * Returns the number of rounds an upper bracket has given the number of participants in the stage.
 *
 * @param participantCount The number of participants in the stage.
 */
function getUpperBracketRoundCount(participantCount) {
    return Math.log2(participantCount);
}
exports.getUpperBracketRoundCount = getUpperBracketRoundCount;
/**
 * Returns the count of round pairs (major & minor) in a loser bracket.
 *
 * @param participantCount The number of participants in the stage.
 */
function getRoundPairCount(participantCount) {
    return getUpperBracketRoundCount(participantCount) - 1;
}
exports.getRoundPairCount = getRoundPairCount;
/**
 * Determines whether a double elimination stage is really necessary.
 *
 * If the size is only two (less is impossible), then a lower bracket and a grand final are not necessary.
 *
 * @param participantCount The number of participants in the stage.
 */
function isDoubleEliminationNecessary(participantCount) {
    return participantCount > 2;
}
exports.isDoubleEliminationNecessary = isDoubleEliminationNecessary;
/**
 * Returns the real (because of loser ordering) number of a match in a loser bracket.
 *
 * @param participantCount The number of participants in a stage.
 * @param roundNumber Number of the round.
 * @param matchNumber Number of the match.
 * @param method The method used for the round.
 */
function findLoserMatchNumber(participantCount, roundNumber, matchNumber, method) {
    const loserCount = getLoserCountFromWbForLbRound(participantCount, roundNumber);
    const losers = Array.from({ length: loserCount }, (_, i) => i + 1);
    const ordered = method ? ordering_1.ordering[method](losers) : losers;
    const matchNumberLB = ordered.indexOf(matchNumber) + 1;
    // For LB round 1, the list of losers is spread over the matches 2 by 2.
    if (roundNumber === 1)
        return Math.ceil(matchNumberLB / 2);
    return matchNumberLB;
}
exports.findLoserMatchNumber = findLoserMatchNumber;
/**
 * Returns the count of matches in a round of a loser bracket.
 *
 * @param participantCount The number of participants in a stage.
 * @param roundNumber Number of the round.
 */
function getLoserRoundMatchCount(participantCount, roundNumber) {
    const roundPairIndex = Math.ceil(roundNumber / 2) - 1;
    const roundPairCount = getRoundPairCount(participantCount);
    const matchCount = Math.pow(2, roundPairCount - roundPairIndex - 1);
    if (roundNumber === 0)
        throw Error('Round number must start at 1.');
    if (matchCount < 1)
        throw Error(`Round number ${roundNumber} is too big for a loser bracket in a stage of ${participantCount} participants.`);
    return matchCount;
}
exports.getLoserRoundMatchCount = getLoserRoundMatchCount;
/**
 * Returns the count of losers coming from the winner bracket in a round of loser bracket.
 *
 * @param participantCount The number of participants in the stage.
 * @param roundNumber Number of the round.
 */
function getLoserCountFromWbForLbRound(participantCount, roundNumber) {
    const matchCount = getLoserRoundMatchCount(participantCount, roundNumber);
    // Two per match for LB round 1 (losers coming from WB round 1).
    if (roundNumber === 1)
        return matchCount * 2;
    return matchCount; // One per match for LB minor rounds.
}
exports.getLoserCountFromWbForLbRound = getLoserCountFromWbForLbRound;
/**
 * Returns the ordering method of a round of a loser bracket.
 *
 * @param seedOrdering The list of seed orderings.
 * @param roundNumber Number of the round.
 */
function getLoserOrdering(seedOrdering, roundNumber) {
    const orderingIndex = 1 + Math.floor(roundNumber / 2);
    return seedOrdering[orderingIndex];
}
exports.getLoserOrdering = getLoserOrdering;
/**
 * Returns the number of rounds a lower bracket has given the number of participants in a double elimination stage.
 *
 * @param participantCount The number of participants in the stage.
 */
function getLowerBracketRoundCount(participantCount) {
    const roundPairCount = getRoundPairCount(participantCount);
    return roundPairCount * 2;
}
exports.getLowerBracketRoundCount = getLowerBracketRoundCount;
/**
 * Returns the match number of the corresponding match in the next round by dividing by two.
 *
 * @param matchNumber The current match number.
 */
function getDiagonalMatchNumber(matchNumber) {
    return Math.ceil(matchNumber / 2);
}
exports.getDiagonalMatchNumber = getDiagonalMatchNumber;
/**
 * Returns the nearest power of two **greater than** or equal to the given number.
 *
 * @param input The input number.
 */
function getNearestPowerOfTwo(input) {
    return Math.pow(2, Math.ceil(Math.log2(input)));
}
exports.getNearestPowerOfTwo = getNearestPowerOfTwo;
/**
 * Returns the minimum score a participant must have to win a Best Of X series match.
 *
 * @param x The count of child games in the series.
 */
function minScoreToWinBestOfX(x) {
    return (x + 1) / 2;
}
exports.minScoreToWinBestOfX = minScoreToWinBestOfX;
/**
 * Checks if a stage is a round-robin stage.
 *
 * @param stage The stage to check.
 */
function isRoundRobin(stage) {
    return stage.type === 'round_robin';
}
exports.isRoundRobin = isRoundRobin;
/**
 * Throws if a stage is round-robin.
 *
 * @param stage The stage to check.
 */
function ensureNotRoundRobin(stage) {
    const inRoundRobin = isRoundRobin(stage);
    if (inRoundRobin)
        throw Error('Impossible to update ordering in a round-robin stage.');
}
exports.ensureNotRoundRobin = ensureNotRoundRobin;
// TODO: delete this helper in a future release.
/**
 * Checks if a round is completed based on its matches.
 *
 * @param roundMatches Matches of the round.
 * @deprecated This is both functionally and semantically incorrect because:
 * 1. A match could be completed because of BYEs.
 * 2. You could totally give a list of matches from different rounds to this function, and it wouldn't complain
 *    although the result will **not** tell you whether a _round_ is completed.
 *
 * Please do something like `matches.every(m => isMatchCompleted(m))` instead.
 */
function isRoundCompleted(roundMatches) {
    return roundMatches.every(match => match.status >= brackets_model_1.Status.Completed);
}
exports.isRoundCompleted = isRoundCompleted;
/**
 * Checks if a group is a winner bracket.
 *
 * It's not always the opposite of `inLoserBracket()`: it could be the only bracket of a single elimination stage.
 *
 * @param stageType Type of the stage.
 * @param groupNumber Number of the group.
 */
function isWinnerBracket(stageType, groupNumber) {
    return stageType === 'double_elimination' && groupNumber === 1;
}
exports.isWinnerBracket = isWinnerBracket;
/**
 * Checks if a group is a loser bracket.
 *
 * @param stageType Type of the stage.
 * @param groupNumber Number of the group.
 */
function isLoserBracket(stageType, groupNumber) {
    return stageType === 'double_elimination' && groupNumber === 2;
}
exports.isLoserBracket = isLoserBracket;
/**
 * Checks if a group is a final group (consolation final or grand final).
 *
 * @param stageType Type of the stage.
 * @param groupNumber Number of the group.
 */
function isFinalGroup(stageType, groupNumber) {
    return stageType === 'single_elimination' && groupNumber === 2 ||
        stageType === 'double_elimination' && groupNumber === 3;
}
exports.isFinalGroup = isFinalGroup;
/**
 * Returns the type of group the match is located into.
 *
 * @param stageType Type of the stage.
 * @param groupNumber Number of the group.
 */
function getMatchLocation(stageType, groupNumber) {
    if (isWinnerBracket(stageType, groupNumber))
        return 'winner_bracket';
    if (isLoserBracket(stageType, groupNumber))
        return 'loser_bracket';
    if (isFinalGroup(stageType, groupNumber))
        return 'final_group';
    return 'single_bracket';
}
exports.getMatchLocation = getMatchLocation;
/**
 * Returns the fraction of final for the current round (e.g. `1/2` for semi finals or `1/4` for quarter finals).
 *
 * @param roundNumber Number of the current round.
 * @param roundCount Count of rounds.
 */
function getFractionOfFinal(roundNumber, roundCount) {
    if (roundNumber > roundCount)
        throw Error(`There are more rounds than possible. ${JSON.stringify({ roundNumber, roundCount })}`);
    const denominator = Math.pow(2, roundCount - roundNumber);
    return 1 / denominator;
}
exports.getFractionOfFinal = getFractionOfFinal;

},{"./ordering":10,"brackets-model":14}],9:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BracketsManager = void 0;
const create_1 = require("./create");
const get_1 = require("./get");
const update_1 = require("./update");
const delete_1 = require("./delete");
const find_1 = require("./find");
const reset_1 = require("./reset");
const uuid_1 = require("uuid");
const helpers = require("./helpers");
/**
 * A class to handle tournament management at those levels: `stage`, `group`, `round`, `match` and `match_game`.
 */
class BracketsManager {
    /**
     * Creates an instance of BracketsManager, which will handle all the stuff from the library.
     *
     * @param storageInterface An implementation of CrudInterface.
     * @param verbose Whether to log CRUD operations.
     */
    constructor(storageInterface, verbose) {
        this.verbose = false;
        this.verbose = verbose !== null && verbose !== void 0 ? verbose : false;
        this.storage = storageInterface;
        this.instrumentStorage();
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        this.storage.selectFirst = async (table, filter, assertUnique = true) => {
            var _a;
            const results = await this.storage.select(table, filter);
            if (!results || results.length === 0)
                return null;
            if (assertUnique && results.length > 1)
                throw Error(`Selecting ${JSON.stringify(filter)} on table "${table}" must return a unique value.`);
            return (_a = results[0]) !== null && _a !== void 0 ? _a : null;
        };
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        this.storage.selectLast = async (table, filter, assertUnique = true) => {
            var _a;
            const results = await this.storage.select(table, filter);
            if (!results || results.length === 0)
                return null;
            if (assertUnique && results.length > 1)
                throw Error(`Selecting ${JSON.stringify(filter)} on table "${table}" must return a unique value.`);
            return (_a = results[results.length - 1]) !== null && _a !== void 0 ? _a : null;
        };
        const create = new create_1.Create(this.storage);
        const createStageFunction = create.stage.bind(this);
        this.create = Object.assign(createStageFunction, { stage: createStageFunction });
        this.get = new get_1.Get(this.storage);
        this.update = new update_1.Update(this.storage);
        this.delete = new delete_1.Delete(this.storage);
        this.find = new find_1.Find(this.storage);
        this.reset = new reset_1.Reset(this.storage);
    }
    /**
     * Imports data in the database.
     *
     * @param data Data to import.
     * @param normalizeIds Enable ID normalization: all IDs (and references to them) are remapped to consecutive IDs starting from 0.
     */
    async import(data, normalizeIds = false) {
        if (normalizeIds)
            data = helpers.normalizeIds(data);
        if (!await this.storage.delete('participant'))
            throw Error('Could not empty the participant table.');
        if (!await this.storage.insert('participant', data.participant))
            throw Error('Could not import participants.');
        if (!await this.storage.delete('stage'))
            throw Error('Could not empty the stage table.');
        if (!await this.storage.insert('stage', data.stage))
            throw Error('Could not import stages.');
        if (!await this.storage.delete('group'))
            throw Error('Could not empty the group table.');
        if (!await this.storage.insert('group', data.group))
            throw Error('Could not import groups.');
        if (!await this.storage.delete('round'))
            throw Error('Could not empty the round table.');
        if (!await this.storage.insert('round', data.round))
            throw Error('Could not import rounds.');
        if (!await this.storage.delete('match'))
            throw Error('Could not empty the match table.');
        if (!await this.storage.insert('match', data.match))
            throw Error('Could not import matches.');
        if (!await this.storage.delete('match_game'))
            throw Error('Could not empty the match_game table.');
        if (!await this.storage.insert('match_game', data.match_game))
            throw Error('Could not import match games.');
    }
    /**
     * Exports data from the database.
     */
    async export() {
        const participants = await this.storage.select('participant');
        if (!participants)
            throw Error('Error getting participants.');
        const stages = await this.storage.select('stage');
        if (!stages)
            throw Error('Error getting stages.');
        const groups = await this.storage.select('group');
        if (!groups)
            throw Error('Error getting groups.');
        const rounds = await this.storage.select('round');
        if (!rounds)
            throw Error('Error getting rounds.');
        const matches = await this.storage.select('match');
        if (!matches)
            throw Error('Error getting matches.');
        const matchGames = await this.get.matchGames(matches);
        return {
            participant: participants,
            stage: stages,
            group: groups,
            round: rounds,
            match: matches,
            match_game: matchGames,
        };
    }
    /**
     * Add `console.log()` to storage methods in verbose mode.
     */
    instrumentStorage() {
        const storage = this.storage;
        const instrumentedMethods = ['insert', 'select', 'update', 'delete'];
        for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(storage))) {
            if (!instrumentedMethods.includes(method))
                continue;
            const originalMethod = storage[method].bind(storage);
            storage[method] = async (table, ...args) => {
                const verbose = this.verbose;
                let id;
                let start;
                if (verbose) {
                    id = (0, uuid_1.v4)();
                    start = Date.now();
                    console.log(`${id} ${method.toUpperCase()} "${table}" args: ${JSON.stringify(args)}`);
                }
                const result = await originalMethod(table, ...args);
                if (verbose) {
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                    const duration = Date.now() - start;
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                    console.log(`${id} ${duration}ms - Returned ${JSON.stringify(result)}`);
                }
                return result;
            };
        }
    }
}
exports.BracketsManager = BracketsManager;

},{"./create":4,"./delete":5,"./find":6,"./get":7,"./helpers":8,"./reset":11,"./update":12,"uuid":19}],10:[function(require,module,exports){
"use strict";
// https://web.archive.org/web/20200601102344/https://tl.net/forum/sc2-tournaments/202139-superior-double-elimination-losers-bracket-seeding
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultMinorOrdering = exports.ordering = void 0;
exports.ordering = {
    'natural': (array) => [...array],
    'reverse': (array) => [...array].reverse(),
    'half_shift': (array) => [...array.slice(array.length / 2), ...array.slice(0, array.length / 2)],
    'reverse_half_shift': (array) => [...array.slice(0, array.length / 2).reverse(), ...array.slice(array.length / 2).reverse()],
    'pair_flip': (array) => {
        const result = [];
        for (let i = 0; i < array.length; i += 2)
            result.push(array[i + 1], array[i]);
        return result;
    },
    'inner_outer': (array) => {
        if (array.length === 2)
            return array;
        const size = array.length / 4;
        const innerPart = [array.slice(size, 2 * size), array.slice(2 * size, 3 * size)]; // [_, X, X, _]
        const outerPart = [array.slice(0, size), array.slice(3 * size, 4 * size)]; // [X, _, _, X]
        const methods = {
            inner(part) {
                return [part[0].pop(), part[1].shift()];
            },
            outer(part) {
                return [part[0].shift(), part[1].pop()];
            },
        };
        const result = [];
        /**
         * Adds a part (inner or outer) of a part.
         *
         * @param part The part to process.
         * @param method The method to use.
         */
        function add(part, method) {
            if (part[0].length > 0 && part[1].length > 0)
                result.push(...methods[method](part));
        }
        for (let i = 0; i < size / 2; i++) {
            add(outerPart, 'outer'); // Outer part's outer
            add(innerPart, 'inner'); // Inner part's inner
            add(outerPart, 'inner'); // Outer part's inner
            add(innerPart, 'outer'); // Inner part's outer
        }
        return result;
    },
    'groups.effort_balanced': (array, groupCount) => {
        const result = [];
        let i = 0, j = 0;
        while (result.length < array.length) {
            result.push(array[i]);
            i += groupCount;
            if (i >= array.length)
                i = ++j;
        }
        return result;
    },
    'groups.seed_optimized': (array, groupCount) => {
        const groups = Array.from({ length: groupCount }, (_) => []);
        for (let run = 0; run < array.length / groupCount; run++) {
            if (run % 2 === 0) {
                for (let group = 0; group < groupCount; group++)
                    groups[group].push(array[run * groupCount + group]);
            }
            else {
                for (let group = 0; group < groupCount; group++)
                    groups[groupCount - group - 1].push(array[run * groupCount + group]);
            }
        }
        return groups.flat();
    },
    'groups.bracket_optimized': () => {
        throw Error('Not implemented.');
    },
};
exports.defaultMinorOrdering = {
    // 1 or 2: Not possible.
    4: ['natural', 'reverse'],
    8: ['natural', 'reverse', 'natural'],
    16: ['natural', 'reverse_half_shift', 'reverse', 'natural'],
    32: ['natural', 'reverse', 'half_shift', 'natural', 'natural'],
    64: ['natural', 'reverse', 'half_shift', 'reverse', 'natural', 'natural'],
    128: ['natural', 'reverse', 'half_shift', 'pair_flip', 'pair_flip', 'pair_flip', 'natural'],
};

},{}],11:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reset = void 0;
const brackets_model_1 = require("brackets-model");
const updater_1 = require("./base/updater");
const helpers = require("./helpers");
class Reset extends updater_1.BaseUpdater {
    /**
     * Resets the results of a match.
     *
     * This will update related matches accordingly.
     *
     * @param matchId ID of the match.
     */
    async matchResults(matchId) {
        const stored = await this.storage.select('match', matchId);
        if (!stored)
            throw Error('Match not found.');
        // The user can handle forfeits with matches which have child games in two possible ways:
        //
        // 1. Set forfeits for the parent match directly.
        //    --> The child games will never be updated: not locked, not finished, without forfeit. They will just be ignored and never be played.
        //    --> To reset the forfeits, the user has to reset the parent match, with `reset.matchResults()`.
        //    --> `reset.matchResults()` will be usable **only** to reset the forfeit of the parent match. Otherwise it will throw the error below.
        //
        // 2. Set forfeits for each child game.
        //    --> The parent match won't automatically have a forfeit, but will be updated with a computed score according to the forfeited match games.
        //    --> To reset the forfeits, the user has to reset each child game on its own, with `reset.matchGameResults()`.
        //    --> `reset.matchResults()` will throw the error below in all cases.
        if (!helpers.isMatchForfeitCompleted(stored) && stored.child_count > 0)
            throw Error('The parent match is controlled by its child games and its result cannot be reset.');
        const stage = await this.storage.select('stage', stored.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        const group = await this.storage.select('group', stored.group_id);
        if (!group)
            throw Error('Group not found.');
        const { roundNumber, roundCount } = await this.getRoundPositionalInfo(stored.round_id);
        const matchLocation = helpers.getMatchLocation(stage.type, group.number);
        const nextMatches = await this.getNextMatches(stored, matchLocation, stage, roundNumber, roundCount);
        if (nextMatches.some(match => match && match.status >= brackets_model_1.Status.Running && !helpers.isMatchByeCompleted(match)))
            throw Error('The match is locked.');
        helpers.resetMatchResults(stored);
        await this.applyMatchUpdate(stored);
        if (!helpers.isRoundRobin(stage))
            await this.updateRelatedMatches(stored, true, true);
    }
    /**
     * Resets the results of a match game.
     *
     * @param gameId ID of the match game.
     */
    async matchGameResults(gameId) {
        const stored = await this.storage.select('match_game', gameId);
        if (!stored)
            throw Error('Match game not found.');
        const stage = await this.storage.select('stage', stored.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        const inRoundRobin = helpers.isRoundRobin(stage);
        helpers.resetMatchResults(stored);
        if (!await this.storage.update('match_game', stored.id, stored))
            throw Error('Could not update the match game.');
        await this.updateParentMatch(stored.parent_id, inRoundRobin);
    }
    /**
     * Resets the seeding of a stage.
     *
     * @param stageId ID of the stage.
     */
    async seeding(stageId) {
        await this.updateSeeding(stageId, { seeding: null }, false);
    }
}
exports.Reset = Reset;

},{"./base/updater":3,"./helpers":8,"brackets-model":14}],12:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Update = void 0;
const brackets_model_1 = require("brackets-model");
const ordering_1 = require("./ordering");
const updater_1 = require("./base/updater");
const helpers = require("./helpers");
class Update extends updater_1.BaseUpdater {
    /**
     * Updates partial information of a match. Its id must be given.
     *
     * This will update related matches accordingly.
     *
     * @param match Values to change in a match.
     */
    async match(match) {
        if (match.id === undefined)
            throw Error('No match id given.');
        const stored = await this.storage.select('match', match.id);
        if (!stored)
            throw Error('Match not found.');
        await this.updateMatch(stored, match);
    }
    /**
     * Updates partial information of a match game. Its id must be given.
     *
     * This will update the parent match accordingly.
     *
     * @param game Values to change in a match game.
     */
    async matchGame(game) {
        const stored = await this.findMatchGame(game);
        await this.updateMatchGame(stored, game);
    }
    /**
     * Updates the seed ordering of every ordered round in a stage.
     *
     * @param stageId ID of the stage.
     * @param seedOrdering A list of ordering methods.
     */
    async ordering(stageId, seedOrdering) {
        const stage = await this.storage.select('stage', stageId);
        if (!stage)
            throw Error('Stage not found.');
        helpers.ensureNotRoundRobin(stage);
        const roundsToOrder = await this.getOrderedRounds(stage);
        if (seedOrdering.length !== roundsToOrder.length)
            throw Error('The count of seed orderings is incorrect.');
        for (let i = 0; i < roundsToOrder.length; i++)
            await this.updateRoundOrdering(roundsToOrder[i], seedOrdering[i]);
    }
    /**
     * Updates the seed ordering of a round.
     *
     * @param roundId ID of the round.
     * @param method Seed ordering method.
     */
    async roundOrdering(roundId, method) {
        const round = await this.storage.select('round', roundId);
        if (!round)
            throw Error('This round does not exist.');
        const stage = await this.storage.select('stage', round.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        helpers.ensureNotRoundRobin(stage);
        await this.updateRoundOrdering(round, method);
    }
    /**
     * Updates child count of all matches of a given level.
     *
     * @param level The level at which to act.
     * @param id ID of the chosen level.
     * @param childCount The target child count.
     */
    async matchChildCount(level, id, childCount) {
        switch (level) {
            case 'stage':
                await this.updateStageMatchChildCount(id, childCount);
                break;
            case 'group':
                await this.updateGroupMatchChildCount(id, childCount);
                break;
            case 'round':
                await this.updateRoundMatchChildCount(id, childCount);
                break;
            case 'match':
                const match = await this.storage.select('match', id);
                if (!match)
                    throw Error('Match not found.');
                await this.adjustMatchChildGames(match, childCount);
                break;
            default:
                throw Error('Unknown child count level.');
        }
    }
    /**
     * Updates the seeding of a stage.
     *
     * @param stageId ID of the stage.
     * @param seeding The new seeding.
     * @param keepSameSize Whether to keep the same size as before for the stage. **Default:** false.
     */
    async seeding(stageId, seeding, keepSameSize = false) {
        await this.updateSeeding(stageId, { seeding }, keepSameSize);
    }
    /**
     * Updates the seeding of a stage (with a list of IDs).
     *
     * @param stageId ID of the stage.
     * @param seedingIds The new seeding, containing only IDs.
     * @param keepSameSize Whether to keep the same size as before for the stage. **Default:** false.
     */
    async seedingIds(stageId, seedingIds, keepSameSize = false) {
        await this.updateSeeding(stageId, { seedingIds }, keepSameSize);
    }
    /**
     * Confirms the seeding of a stage.
     *
     * This will convert TBDs to BYEs and propagate them.
     *
     * @param stageId ID of the stage.
     */
    async confirmSeeding(stageId) {
        await this.confirmCurrentSeeding(stageId);
    }
    /**
     * Update the seed ordering of a round.
     *
     * @param round The round of which to update the ordering.
     * @param method The new ordering method.
     */
    async updateRoundOrdering(round, method) {
        const matches = await this.storage.select('match', { round_id: round.id });
        if (!matches)
            throw Error('This round has no match.');
        if (matches.some(match => match.status > brackets_model_1.Status.Ready))
            throw Error('At least one match has started or is completed.');
        const stage = await this.storage.select('stage', round.stage_id);
        if (!stage)
            throw Error('Stage not found.');
        if (stage.settings.size === undefined)
            throw Error('Undefined stage size.');
        const group = await this.storage.select('group', round.group_id);
        if (!group)
            throw Error('Group not found.');
        const inLoserBracket = helpers.isLoserBracket(stage.type, group.number);
        const roundCountLB = helpers.getLowerBracketRoundCount(stage.settings.size);
        const seeds = helpers.getSeeds(inLoserBracket, round.number, roundCountLB, matches.length);
        const positions = ordering_1.ordering[method](seeds);
        await this.applyRoundOrdering(round.number, matches, positions);
    }
    /**
     * Updates child count of all matches of a stage.
     *
     * @param stageId ID of the stage.
     * @param childCount The target child count.
     */
    async updateStageMatchChildCount(stageId, childCount) {
        if (!await this.storage.update('match', { stage_id: stageId }, { child_count: childCount }))
            throw Error('Could not update the match.');
        const matches = await this.storage.select('match', { stage_id: stageId });
        if (!matches)
            throw Error('This stage has no match.');
        for (const match of matches)
            await this.adjustMatchChildGames(match, childCount);
    }
    /**
     * Updates child count of all matches of a group.
     *
     * @param groupId ID of the group.
     * @param childCount The target child count.
     */
    async updateGroupMatchChildCount(groupId, childCount) {
        if (!await this.storage.update('match', { group_id: groupId }, { child_count: childCount }))
            throw Error('Could not update the match.');
        const matches = await this.storage.select('match', { group_id: groupId });
        if (!matches)
            throw Error('This group has no match.');
        for (const match of matches)
            await this.adjustMatchChildGames(match, childCount);
    }
    /**
     * Updates child count of all matches of a round.
     *
     * @param roundId ID of the round.
     * @param childCount The target child count.
     */
    async updateRoundMatchChildCount(roundId, childCount) {
        if (!await this.storage.update('match', { round_id: roundId }, { child_count: childCount }))
            throw Error('Could not update the match.');
        const matches = await this.storage.select('match', { round_id: roundId });
        if (!matches)
            throw Error('This round has no match.');
        for (const match of matches)
            await this.adjustMatchChildGames(match, childCount);
    }
    /**
     * Updates the ordering of participants in a round's matches.
     *
     * @param roundNumber The number of the round.
     * @param matches The matches of the round.
     * @param positions The new positions.
     */
    async applyRoundOrdering(roundNumber, matches, positions) {
        for (const match of matches) {
            const updated = { ...match };
            updated.opponent1 = helpers.findPosition(matches, positions.shift());
            // The only rounds where we have a second ordered participant are first rounds of brackets (upper and lower).
            if (roundNumber === 1)
                updated.opponent2 = helpers.findPosition(matches, positions.shift());
            if (!await this.storage.update('match', updated.id, updated))
                throw Error('Could not update the match.');
        }
    }
    /**
     * Adds or deletes match games of a match based on a target child count.
     *
     * @param match The match of which child games need to be adjusted.
     * @param targetChildCount The target child count.
     */
    async adjustMatchChildGames(match, targetChildCount) {
        const games = await this.storage.select('match_game', { parent_id: match.id });
        let childCount = games ? games.length : 0;
        while (childCount < targetChildCount) {
            const id = await this.storage.insert('match_game', {
                number: childCount + 1,
                stage_id: match.stage_id,
                parent_id: match.id,
                status: match.status,
                opponent1: { id: null },
                opponent2: { id: null },
            });
            if (id === -1)
                throw Error('Could not adjust the match games when inserting.');
            childCount++;
        }
        while (childCount > targetChildCount) {
            const deleted = await this.storage.delete('match_game', {
                parent_id: match.id,
                number: childCount,
            });
            if (!deleted)
                throw Error('Could not adjust the match games when deleting.');
            childCount--;
        }
        if (!await this.storage.update('match', match.id, { ...match, child_count: targetChildCount }))
            throw Error('Could not update the match.');
    }
}
exports.Update = Update;

},{"./base/updater":3,"./helpers":8,"./ordering":10,"brackets-model":14}],13:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StageCreator = exports.Delete = exports.Reset = exports.Find = exports.Update = exports.Get = exports.ordering = exports.helpers = exports.BracketsManager = void 0;
var manager_1 = require("./manager");
Object.defineProperty(exports, "BracketsManager", { enumerable: true, get: function () { return manager_1.BracketsManager; } });
exports.helpers = require("./helpers");
var ordering_1 = require("./ordering");
Object.defineProperty(exports, "ordering", { enumerable: true, get: function () { return ordering_1.ordering; } });
var get_1 = require("./get");
Object.defineProperty(exports, "Get", { enumerable: true, get: function () { return get_1.Get; } });
var update_1 = require("./update");
Object.defineProperty(exports, "Update", { enumerable: true, get: function () { return update_1.Update; } });
var find_1 = require("./find");
Object.defineProperty(exports, "Find", { enumerable: true, get: function () { return find_1.Find; } });
var reset_1 = require("./reset");
Object.defineProperty(exports, "Reset", { enumerable: true, get: function () { return reset_1.Reset; } });
var delete_1 = require("./delete");
Object.defineProperty(exports, "Delete", { enumerable: true, get: function () { return delete_1.Delete; } });
var creator_1 = require("./base/stage/creator");
Object.defineProperty(exports, "StageCreator", { enumerable: true, get: function () { return creator_1.StageCreator; } });

},{"./base/stage/creator":2,"./delete":5,"./find":6,"./get":7,"./helpers":8,"./manager":9,"./ordering":10,"./reset":11,"./update":12}],14:[function(require,module,exports){
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./unions"), exports);
__exportStar(require("./input"), exports);
__exportStar(require("./storage"), exports);
__exportStar(require("./other"), exports);

},{"./input":15,"./other":16,"./storage":17,"./unions":18}],15:[function(require,module,exports){
"use strict";
/*------------------------------------------------------------|
 * Contains everything which is given by the user as input.
 *-----------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });

},{}],16:[function(require,module,exports){
"use strict";
/*---------------------------------------------------------------------------|
 * Contains the rest of the types which doesn't belong to the other files.
 *--------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Status = void 0;
/**
 * The possible status for a match.
 */
var Status;
(function (Status) {
    /** The two matches leading to this one are not completed yet. */
    Status[Status["Locked"] = 0] = "Locked";
    /** One participant is ready and waiting for the other one. */
    Status[Status["Waiting"] = 1] = "Waiting";
    /** Both participants are ready to start. */
    Status[Status["Ready"] = 2] = "Ready";
    /** The match is running. */
    Status[Status["Running"] = 3] = "Running";
    /** The match is completed. */
    Status[Status["Completed"] = 4] = "Completed";
    /** At least one participant completed his following match. */
    Status[Status["Archived"] = 5] = "Archived";
})(Status = exports.Status || (exports.Status = {}));

},{}],17:[function(require,module,exports){
"use strict";
/*-----------------------------------------------------------------|
 * Contains the types which are persisted in the chosen storage.
 *----------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });

},{}],18:[function(require,module,exports){
"use strict";
/*----------------------------------------|
 * Contains all the string union types.
 *---------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });

},{}],19:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "NIL", {
  enumerable: true,
  get: function () {
    return _nil.default;
  }
});
Object.defineProperty(exports, "parse", {
  enumerable: true,
  get: function () {
    return _parse.default;
  }
});
Object.defineProperty(exports, "stringify", {
  enumerable: true,
  get: function () {
    return _stringify.default;
  }
});
Object.defineProperty(exports, "v1", {
  enumerable: true,
  get: function () {
    return _v.default;
  }
});
Object.defineProperty(exports, "v3", {
  enumerable: true,
  get: function () {
    return _v2.default;
  }
});
Object.defineProperty(exports, "v4", {
  enumerable: true,
  get: function () {
    return _v3.default;
  }
});
Object.defineProperty(exports, "v5", {
  enumerable: true,
  get: function () {
    return _v4.default;
  }
});
Object.defineProperty(exports, "validate", {
  enumerable: true,
  get: function () {
    return _validate.default;
  }
});
Object.defineProperty(exports, "version", {
  enumerable: true,
  get: function () {
    return _version.default;
  }
});

var _v = _interopRequireDefault(require("./v1.js"));

var _v2 = _interopRequireDefault(require("./v3.js"));

var _v3 = _interopRequireDefault(require("./v4.js"));

var _v4 = _interopRequireDefault(require("./v5.js"));

var _nil = _interopRequireDefault(require("./nil.js"));

var _version = _interopRequireDefault(require("./version.js"));

var _validate = _interopRequireDefault(require("./validate.js"));

var _stringify = _interopRequireDefault(require("./stringify.js"));

var _parse = _interopRequireDefault(require("./parse.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
},{"./nil.js":22,"./parse.js":23,"./stringify.js":27,"./v1.js":28,"./v3.js":29,"./v4.js":31,"./v5.js":32,"./validate.js":33,"./version.js":34}],20:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

/*
 * Browser-compatible JavaScript MD5
 *
 * Modification of JavaScript MD5
 * https://github.com/blueimp/JavaScript-MD5
 *
 * Copyright 2011, Sebastian Tschan
 * https://blueimp.net
 *
 * Licensed under the MIT license:
 * https://opensource.org/licenses/MIT
 *
 * Based on
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.2 Copyright (C) Paul Johnston 1999 - 2009
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */
function md5(bytes) {
  if (typeof bytes === 'string') {
    const msg = unescape(encodeURIComponent(bytes)); // UTF8 escape

    bytes = new Uint8Array(msg.length);

    for (let i = 0; i < msg.length; ++i) {
      bytes[i] = msg.charCodeAt(i);
    }
  }

  return md5ToHexEncodedArray(wordsToMd5(bytesToWords(bytes), bytes.length * 8));
}
/*
 * Convert an array of little-endian words to an array of bytes
 */


function md5ToHexEncodedArray(input) {
  const output = [];
  const length32 = input.length * 32;
  const hexTab = '0123456789abcdef';

  for (let i = 0; i < length32; i += 8) {
    const x = input[i >> 5] >>> i % 32 & 0xff;
    const hex = parseInt(hexTab.charAt(x >>> 4 & 0x0f) + hexTab.charAt(x & 0x0f), 16);
    output.push(hex);
  }

  return output;
}
/**
 * Calculate output length with padding and bit length
 */


function getOutputLength(inputLength8) {
  return (inputLength8 + 64 >>> 9 << 4) + 14 + 1;
}
/*
 * Calculate the MD5 of an array of little-endian words, and a bit length.
 */


function wordsToMd5(x, len) {
  /* append padding */
  x[len >> 5] |= 0x80 << len % 32;
  x[getOutputLength(len) - 1] = len;
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < x.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;
    a = md5ff(a, b, c, d, x[i], 7, -680876936);
    d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
    b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = md5gg(b, c, d, a, x[i], 20, -373897302);
    a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
    d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = md5hh(d, a, b, c, x[i], 11, -358537222);
    c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = md5ii(a, b, c, d, x[i], 6, -198630844);
    d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }

  return [a, b, c, d];
}
/*
 * Convert an array bytes to an array of little-endian words
 * Characters >255 have their high-byte silently ignored.
 */


function bytesToWords(input) {
  if (input.length === 0) {
    return [];
  }

  const length8 = input.length * 8;
  const output = new Uint32Array(getOutputLength(length8));

  for (let i = 0; i < length8; i += 8) {
    output[i >> 5] |= (input[i / 8] & 0xff) << i % 32;
  }

  return output;
}
/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */


function safeAdd(x, y) {
  const lsw = (x & 0xffff) + (y & 0xffff);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return msw << 16 | lsw & 0xffff;
}
/*
 * Bitwise rotate a 32-bit number to the left.
 */


function bitRotateLeft(num, cnt) {
  return num << cnt | num >>> 32 - cnt;
}
/*
 * These functions implement the four basic operations the algorithm uses.
 */


function md5cmn(q, a, b, x, s, t) {
  return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
}

function md5ff(a, b, c, d, x, s, t) {
  return md5cmn(b & c | ~b & d, a, b, x, s, t);
}

function md5gg(a, b, c, d, x, s, t) {
  return md5cmn(b & d | c & ~d, a, b, x, s, t);
}

function md5hh(a, b, c, d, x, s, t) {
  return md5cmn(b ^ c ^ d, a, b, x, s, t);
}

function md5ii(a, b, c, d, x, s, t) {
  return md5cmn(c ^ (b | ~d), a, b, x, s, t);
}

var _default = md5;
exports.default = _default;
},{}],21:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
const randomUUID = typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID.bind(crypto);
var _default = {
  randomUUID
};
exports.default = _default;
},{}],22:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _default = '00000000-0000-0000-0000-000000000000';
exports.default = _default;
},{}],23:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _validate = _interopRequireDefault(require("./validate.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function parse(uuid) {
  if (!(0, _validate.default)(uuid)) {
    throw TypeError('Invalid UUID');
  }

  let v;
  const arr = new Uint8Array(16); // Parse ########-....-....-....-............

  arr[0] = (v = parseInt(uuid.slice(0, 8), 16)) >>> 24;
  arr[1] = v >>> 16 & 0xff;
  arr[2] = v >>> 8 & 0xff;
  arr[3] = v & 0xff; // Parse ........-####-....-....-............

  arr[4] = (v = parseInt(uuid.slice(9, 13), 16)) >>> 8;
  arr[5] = v & 0xff; // Parse ........-....-####-....-............

  arr[6] = (v = parseInt(uuid.slice(14, 18), 16)) >>> 8;
  arr[7] = v & 0xff; // Parse ........-....-....-####-............

  arr[8] = (v = parseInt(uuid.slice(19, 23), 16)) >>> 8;
  arr[9] = v & 0xff; // Parse ........-....-....-....-############
  // (Use "/" to avoid 32-bit truncation when bit-shifting high-order bytes)

  arr[10] = (v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000 & 0xff;
  arr[11] = v / 0x100000000 & 0xff;
  arr[12] = v >>> 24 & 0xff;
  arr[13] = v >>> 16 & 0xff;
  arr[14] = v >>> 8 & 0xff;
  arr[15] = v & 0xff;
  return arr;
}

var _default = parse;
exports.default = _default;
},{"./validate.js":33}],24:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
exports.default = _default;
},{}],25:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = rng;
// Unique ID creation requires a high quality random # generator. In the browser we therefore
// require the crypto API and do not support built-in fallback to lower quality random number
// generators (like Math.random()).
let getRandomValues;
const rnds8 = new Uint8Array(16);

function rng() {
  // lazy load so that environments that need to polyfill have a chance to do so
  if (!getRandomValues) {
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation.
    getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto);

    if (!getRandomValues) {
      throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
    }
  }

  return getRandomValues(rnds8);
}
},{}],26:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

// Adapted from Chris Veness' SHA1 code at
// http://www.movable-type.co.uk/scripts/sha1.html
function f(s, x, y, z) {
  switch (s) {
    case 0:
      return x & y ^ ~x & z;

    case 1:
      return x ^ y ^ z;

    case 2:
      return x & y ^ x & z ^ y & z;

    case 3:
      return x ^ y ^ z;
  }
}

function ROTL(x, n) {
  return x << n | x >>> 32 - n;
}

function sha1(bytes) {
  const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];
  const H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

  if (typeof bytes === 'string') {
    const msg = unescape(encodeURIComponent(bytes)); // UTF8 escape

    bytes = [];

    for (let i = 0; i < msg.length; ++i) {
      bytes.push(msg.charCodeAt(i));
    }
  } else if (!Array.isArray(bytes)) {
    // Convert Array-like to Array
    bytes = Array.prototype.slice.call(bytes);
  }

  bytes.push(0x80);
  const l = bytes.length / 4 + 2;
  const N = Math.ceil(l / 16);
  const M = new Array(N);

  for (let i = 0; i < N; ++i) {
    const arr = new Uint32Array(16);

    for (let j = 0; j < 16; ++j) {
      arr[j] = bytes[i * 64 + j * 4] << 24 | bytes[i * 64 + j * 4 + 1] << 16 | bytes[i * 64 + j * 4 + 2] << 8 | bytes[i * 64 + j * 4 + 3];
    }

    M[i] = arr;
  }

  M[N - 1][14] = (bytes.length - 1) * 8 / Math.pow(2, 32);
  M[N - 1][14] = Math.floor(M[N - 1][14]);
  M[N - 1][15] = (bytes.length - 1) * 8 & 0xffffffff;

  for (let i = 0; i < N; ++i) {
    const W = new Uint32Array(80);

    for (let t = 0; t < 16; ++t) {
      W[t] = M[i][t];
    }

    for (let t = 16; t < 80; ++t) {
      W[t] = ROTL(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1);
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];

    for (let t = 0; t < 80; ++t) {
      const s = Math.floor(t / 20);
      const T = ROTL(a, 5) + f(s, b, c, d) + e + K[s] + W[t] >>> 0;
      e = d;
      d = c;
      c = ROTL(b, 30) >>> 0;
      b = a;
      a = T;
    }

    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
  }

  return [H[0] >> 24 & 0xff, H[0] >> 16 & 0xff, H[0] >> 8 & 0xff, H[0] & 0xff, H[1] >> 24 & 0xff, H[1] >> 16 & 0xff, H[1] >> 8 & 0xff, H[1] & 0xff, H[2] >> 24 & 0xff, H[2] >> 16 & 0xff, H[2] >> 8 & 0xff, H[2] & 0xff, H[3] >> 24 & 0xff, H[3] >> 16 & 0xff, H[3] >> 8 & 0xff, H[3] & 0xff, H[4] >> 24 & 0xff, H[4] >> 16 & 0xff, H[4] >> 8 & 0xff, H[4] & 0xff];
}

var _default = sha1;
exports.default = _default;
},{}],27:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
exports.unsafeStringify = unsafeStringify;

var _validate = _interopRequireDefault(require("./validate.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */
const byteToHex = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!(0, _validate.default)(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

var _default = stringify;
exports.default = _default;
},{"./validate.js":33}],28:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _rng = _interopRequireDefault(require("./rng.js"));

var _stringify = require("./stringify.js");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html
let _nodeId;

let _clockseq; // Previous uuid creation time


let _lastMSecs = 0;
let _lastNSecs = 0; // See https://github.com/uuidjs/uuid for API details

function v1(options, buf, offset) {
  let i = buf && offset || 0;
  const b = buf || new Array(16);
  options = options || {};
  let node = options.node || _nodeId;
  let clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq; // node and clockseq need to be initialized to random values if they're not
  // specified.  We do this lazily to minimize issues related to insufficient
  // system entropy.  See #189

  if (node == null || clockseq == null) {
    const seedBytes = options.random || (options.rng || _rng.default)();

    if (node == null) {
      // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
      node = _nodeId = [seedBytes[0] | 0x01, seedBytes[1], seedBytes[2], seedBytes[3], seedBytes[4], seedBytes[5]];
    }

    if (clockseq == null) {
      // Per 4.2.2, randomize (14 bit) clockseq
      clockseq = _clockseq = (seedBytes[6] << 8 | seedBytes[7]) & 0x3fff;
    }
  } // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.


  let msecs = options.msecs !== undefined ? options.msecs : Date.now(); // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock

  let nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1; // Time since last uuid creation (in msecs)

  const dt = msecs - _lastMSecs + (nsecs - _lastNSecs) / 10000; // Per 4.2.1.2, Bump clockseq on clock regression

  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  } // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval


  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  } // Per 4.2.1.2 Throw error if too many uuids are requested


  if (nsecs >= 10000) {
    throw new Error("uuid.v1(): Can't create more than 10M uuids/sec");
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq; // Per 4.1.4 - Convert from unix epoch to Gregorian epoch

  msecs += 12219292800000; // `time_low`

  const tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff; // `time_mid`

  const tmh = msecs / 0x100000000 * 10000 & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff; // `time_high_and_version`

  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version

  b[i++] = tmh >>> 16 & 0xff; // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)

  b[i++] = clockseq >>> 8 | 0x80; // `clock_seq_low`

  b[i++] = clockseq & 0xff; // `node`

  for (let n = 0; n < 6; ++n) {
    b[i + n] = node[n];
  }

  return buf || (0, _stringify.unsafeStringify)(b);
}

var _default = v1;
exports.default = _default;
},{"./rng.js":25,"./stringify.js":27}],29:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _v = _interopRequireDefault(require("./v35.js"));

var _md = _interopRequireDefault(require("./md5.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const v3 = (0, _v.default)('v3', 0x30, _md.default);
var _default = v3;
exports.default = _default;
},{"./md5.js":20,"./v35.js":30}],30:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.URL = exports.DNS = void 0;
exports.default = v35;

var _stringify = require("./stringify.js");

var _parse = _interopRequireDefault(require("./parse.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function stringToBytes(str) {
  str = unescape(encodeURIComponent(str)); // UTF8 escape

  const bytes = [];

  for (let i = 0; i < str.length; ++i) {
    bytes.push(str.charCodeAt(i));
  }

  return bytes;
}

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
exports.DNS = DNS;
const URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
exports.URL = URL;

function v35(name, version, hashfunc) {
  function generateUUID(value, namespace, buf, offset) {
    var _namespace;

    if (typeof value === 'string') {
      value = stringToBytes(value);
    }

    if (typeof namespace === 'string') {
      namespace = (0, _parse.default)(namespace);
    }

    if (((_namespace = namespace) === null || _namespace === void 0 ? void 0 : _namespace.length) !== 16) {
      throw TypeError('Namespace must be array-like (16 iterable integer values, 0-255)');
    } // Compute hash of namespace and value, Per 4.3
    // Future: Use spread syntax when supported on all platforms, e.g. `bytes =
    // hashfunc([...namespace, ... value])`


    let bytes = new Uint8Array(16 + value.length);
    bytes.set(namespace);
    bytes.set(value, namespace.length);
    bytes = hashfunc(bytes);
    bytes[6] = bytes[6] & 0x0f | version;
    bytes[8] = bytes[8] & 0x3f | 0x80;

    if (buf) {
      offset = offset || 0;

      for (let i = 0; i < 16; ++i) {
        buf[offset + i] = bytes[i];
      }

      return buf;
    }

    return (0, _stringify.unsafeStringify)(bytes);
  } // Function#name is not settable on some platforms (#270)


  try {
    generateUUID.name = name; // eslint-disable-next-line no-empty
  } catch (err) {} // For CommonJS default export support


  generateUUID.DNS = DNS;
  generateUUID.URL = URL;
  return generateUUID;
}
},{"./parse.js":23,"./stringify.js":27}],31:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _native = _interopRequireDefault(require("./native.js"));

var _rng = _interopRequireDefault(require("./rng.js"));

var _stringify = require("./stringify.js");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function v4(options, buf, offset) {
  if (_native.default.randomUUID && !buf && !options) {
    return _native.default.randomUUID();
  }

  options = options || {};

  const rnds = options.random || (options.rng || _rng.default)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`


  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return (0, _stringify.unsafeStringify)(rnds);
}

var _default = v4;
exports.default = _default;
},{"./native.js":21,"./rng.js":25,"./stringify.js":27}],32:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _v = _interopRequireDefault(require("./v35.js"));

var _sha = _interopRequireDefault(require("./sha1.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const v5 = (0, _v.default)('v5', 0x50, _sha.default);
var _default = v5;
exports.default = _default;
},{"./sha1.js":26,"./v35.js":30}],33:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _regex = _interopRequireDefault(require("./regex.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function validate(uuid) {
  return typeof uuid === 'string' && _regex.default.test(uuid);
}

var _default = validate;
exports.default = _default;
},{"./regex.js":24}],34:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _validate = _interopRequireDefault(require("./validate.js"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function version(uuid) {
  if (!(0, _validate.default)(uuid)) {
    throw TypeError('Invalid UUID');
  }

  return parseInt(uuid.slice(14, 15), 16);
}

var _default = version;
exports.default = _default;
},{"./validate.js":33}]},{},[13]);
