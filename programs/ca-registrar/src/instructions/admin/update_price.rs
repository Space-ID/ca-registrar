#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;
use crate::error::CaRegistrarError;

/// Account constraints for updating base price instruction
/// 
/// This instruction allows the program administrator to update the base price (in USD cents) for domain registration.
#[derive(Accounts)]
pub struct UpdatePriceAccountConstraints<'info> {
    /// Program administrator, must match the authority in ProgramState
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Program state account
    #[account(
        mut,
        has_one = authority @ CaRegistrarError::NotProgramAuthority,
        seeds = [PROGRAM_STATE_SEED],
        bump = program_state.bump
    )]
    pub program_state: Account<'info, ProgramState>,
}

/// Update base price for domain registration
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `new_price` - New base price (in USD cents, e.g., 500 means $5.00)
pub fn update_price_handler(
    context: Context<UpdatePriceAccountConstraints>,
    new_price: u64,
) -> Result<()> {
    let program_state = &mut context.accounts.program_state;
    
    // Update base price
    program_state.base_price_usd = new_price;
    
    msg!("Base price updated to: {} USD cents", new_price);
    
    Ok(())
} 