#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;

/// Account constraints for program initialization instruction
/// 
/// This instruction is used to set up the initial program state, including admin authority and base price.
/// It can only be executed once.
#[derive(Accounts)]
pub struct InitializeAccountConstraints<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Program state account (PDA)
    #[account(
        init,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR + ProgramState::INIT_SPACE,
        seeds = [PROGRAM_STATE_SEED],
        bump
    )]
    pub program_state: Account<'info, ProgramState>,

    pub system_program: Program<'info, System>,
}

/// Initialize program state
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `base_price_usd` - Base price for domain registration (in USD cents, e.g., 500 means $5.00)
///                     This price is only used when not using the oracle
/// * `grace_period_seconds` - Grace period in seconds for domain registration
pub fn initialize_handler(
    context: Context<InitializeAccountConstraints>,
    base_price_usd: u64,
    grace_period_seconds: i64,
) -> Result<()> {
    let program_state = &mut context.accounts.program_state;
    
    // Set program state
    program_state.authority = context.accounts.authority.key();
    program_state.base_price_usd = base_price_usd;
    program_state.domains_registered = 0;
    program_state.grace_period_seconds = grace_period_seconds;
    program_state.bump = context.bumps.program_state;
    
    msg!("Program initialized with authority: {}", program_state.authority);
    msg!("Base price set to: {} USD cents", program_state.base_price_usd);
    msg!("Grace period set to: {} days", program_state.grace_period_seconds / 86400);
    
    Ok(())
} 