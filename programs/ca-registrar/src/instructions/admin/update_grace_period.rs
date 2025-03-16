#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use crate::constants::*;
use crate::state::*;
use crate::error::CaRegistrarError;

/// Account constraints for updating grace period instruction
/// 
/// This instruction allows the program administrator to update the grace period duration after domain expiration.
#[derive(Accounts)]
pub struct UpdateGracePeriodAccountConstraints<'info> {
    /// Program administrator, must match the authority in ProgramState
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

/// Update grace period duration after domain expiration
/// 
/// # Parameters
/// * `context` - Instruction context, containing all relevant accounts
/// * `grace_period_seconds` - New grace period in seconds
pub fn update_grace_period_handler(
    context: Context<UpdateGracePeriodAccountConstraints>,
    grace_period_seconds: i64,
) -> Result<()> {
    let program_state = &mut context.accounts.program_state;

    // Update grace period
    program_state.grace_period_seconds = grace_period_seconds;
    
    msg!("Grace period updated to: {} seconds", 
        grace_period_seconds
    );
    
    Ok(())
} 