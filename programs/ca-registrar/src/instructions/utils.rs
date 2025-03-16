use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;

// get current timestamp
pub fn get_current_timestamp() -> Result<i64> {
    let clock = Clock::get()?;
    Ok(clock.unix_timestamp)
}

