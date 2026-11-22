"""create campaign snapshots

Revision ID: 20261122_01
Revises:
"""

from alembic import op
import sqlalchemy as sa

revision = "20261122_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaign_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("job_title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("campaign_snapshots")
