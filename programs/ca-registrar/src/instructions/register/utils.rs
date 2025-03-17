use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};
use anchor_lang::solana_program::native_token::LAMPORTS_PER_SOL;
use crate::constants::*;
use crate::error::CaRegistrarError;

/// Calculate yearly fee in lamports based on Pyth price oracle
/// 
/// Converts the base price to lamports according to current SOL/USD rate
pub fn calculate_yearly_fee_in_lamports(
    price_update: &Account<PriceUpdateV2>,
    base_price_usd: u64,
    years: u64,
) -> Result<u64> {
    // Get SOL/USD price information
    let feed_id = get_feed_id_from_hex(SOL_USD_PRICE_FEED_ID)?;
    let price_info = price_update.get_price_no_older_than(
        &Clock::get()?, 
        PYTH_PRICE_FEED_MAX_AGE,
        &feed_id
    )?;
    
    // verify price is valid
    require!(price_info.price > 0, CaRegistrarError::InvalidPriceFeed);
    
    // calculate lamports per year
    let lamports = (base_price_usd as u128 * LAMPORTS_PER_SOL as u128 * 10_u128.pow((-price_info.exponent) as u32)) 
                  / (price_info.price as u128 * 100);
    
    let yearly_fee = lamports
        .checked_mul(years as u128)
        .ok_or(error!(CaRegistrarError::MathOverflow))?;
    
    Ok(yearly_fee as u64)
}

/// Calculate domain expiry timestamp
pub fn calculate_expiry_timestamp(current_timestamp: i64, years: u64) -> i64 {  
    current_timestamp + (SECONDS_PER_YEAR * years as i64)
}

