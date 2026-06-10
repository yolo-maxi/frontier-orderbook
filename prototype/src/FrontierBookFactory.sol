// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RollingFrontierBook} from "./RollingFrontierBook.sol";

/// @notice Spins up independent rolling-frontier books. Markets are meant to
/// be cheap and ephemeral: anyone can launch one for any (token0, token1)
/// pair with whatever tick spacing fits their use case, run several in
/// parallel (e.g. a fine-grained book and a coarse one for the same pair),
/// and simply abandon a book once its orders are claimed/cancelled — books
/// hold no protocol-wide state and need no cleanup.
contract FrontierBookFactory {
    event BookCreated(
        address indexed book,
        address indexed token0,
        address indexed token1,
        int24 tickSpacing,
        int24 startTick,
        address creator
    );

    address[] public books;

    function bookCount() external view returns (uint256) {
        return books.length;
    }

    function createBook(address token0, address token1, int24 tickSpacing, int24 startTick)
        external
        returns (address book)
    {
        require(token0 != token1 && token0 != address(0) && token1 != address(0), "bad tokens");
        book = address(new RollingFrontierBook(token0, token1, tickSpacing, startTick));
        books.push(book);
        emit BookCreated(book, token0, token1, tickSpacing, startTick, msg.sender);
    }
}
